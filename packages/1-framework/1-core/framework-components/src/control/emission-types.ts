import type { Contract, ContractModel } from '@prisma-next/contract/types';
import type { TypesImportSpec } from '../shared/types-import-spec';

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
   * Per-family resolver for typeParams that don't live inline on the
   * framework-domain `ContractField`. Some families (notably SQL) let columns
   * reference a named entry in `storage.types` via `typeRef`; the typeParams
   * live on that named entry rather than on the domain field. The framework
   * emit path consults this hook so the codec's `renderOutputType` can run
   * for typeRef-shaped columns.
   *
   * Inline `field.type.typeParams` always takes precedence; the hook is only
   * consulted when the domain field has no typeParams. Families without
   * named storage types (e.g. mongo) don't implement this hook.
   *
   * Returns `undefined` when the field has no resolvable typeParams.
   */
  resolveFieldTypeParams?(
    modelName: string,
    fieldName: string,
    model: ContractModel,
    contract: Contract,
  ): Record<string, unknown> | undefined;
}
