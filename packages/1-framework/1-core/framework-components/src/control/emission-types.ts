import type { Contract, ContractField, ContractModelBase } from '@prisma-next/contract/types';
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
    model: ContractModelBase,
    contract: Contract,
  ): Record<string, unknown> | undefined;

  /**
   * Per-family hook that fully overrides the rendered output/input type for a
   * single domain field. Called before the framework's default scalar/enum
   * narrowing logic runs. The SQL family uses this to source the type from the
   * storage column's value-set (baked literal union) rather than from the
   * domain enum block, keeping value-set narrowing inside the SQL family.
   *
   * Returns `undefined` to fall through to the framework's default logic.
   */
  resolveFieldType?(
    modelName: string,
    fieldName: string,
    field: ContractField,
    model: ContractModelBase,
    contract: Contract,
  ): ResolvedFieldTypeStrings | undefined;

  /**
   * Optional hook for emitting a family-specific top-level type export that
   * depends on the full contract (e.g. SQL's `StorageColumnTypes` map).
   *
   * Returns a string of one or more `export type ...` declarations to insert
   * after the standard `FieldOutputTypes`/`FieldInputTypes` exports, or
   * `undefined` if the family has nothing to add.
   */
  getExtraTypeExports?(contract: Contract): string | undefined;
}
