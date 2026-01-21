import type { ColumnDefault } from '@prisma-next/contract/types';

/**
 * Column type descriptor containing both codec ID and native type.
 * Used when defining columns with descriptor objects instead of string IDs.
 *
 * For parameterized types (e.g., `vector(1536)`), the `typeParams` field
 * carries codec-owned parameters that affect both TypeScript type generation
 * and native DDL output.
 */
export type ColumnTypeDescriptor = {
  readonly codecId: string;
  readonly nativeType: string;
  readonly typeParams?: Record<string, unknown>;
};

/**
 * Column default value definition for the builder.
 */
export type ColumnDefaultDef = ColumnDefault;

export interface ColumnBuilderState<
  Name extends string,
  Nullable extends boolean,
  Type extends string,
> {
  readonly name: Name;
  readonly nullable: Nullable;
  readonly type: Type;
  readonly nativeType: string;
  readonly typeParams?: Record<string, unknown>;
  readonly default?: ColumnDefaultDef;
}

/**
 * Unique constraint definition for table builder.
 */
export interface UniqueConstraintDef {
  readonly columns: readonly string[];
  readonly name?: string;
}

/**
 * Index definition for table builder.
 */
export interface IndexDef {
  readonly columns: readonly string[];
  readonly name?: string;
}

/**
 * Foreign key definition for table builder.
 */
export interface ForeignKeyDef {
  readonly columns: readonly string[];
  readonly references: {
    readonly table: string;
    readonly columns: readonly string[];
  };
  readonly name?: string;
}

export interface TableBuilderState<
  Name extends string,
  Columns extends Record<string, ColumnBuilderState<string, boolean, string>>,
  PrimaryKey extends readonly string[] | undefined,
> {
  readonly name: Name;
  readonly columns: Columns;
  readonly primaryKey?: PrimaryKey;
  readonly primaryKeyName?: string;
  readonly uniques: readonly UniqueConstraintDef[];
  readonly indexes: readonly IndexDef[];
  readonly foreignKeys: readonly ForeignKeyDef[];
}

export type RelationDefinition = {
  readonly to: string;
  readonly cardinality: '1:1' | '1:N' | 'N:1' | 'N:M';
  readonly on: {
    readonly parentCols: readonly string[];
    readonly childCols: readonly string[];
  };
  readonly through?: {
    readonly table: string;
    readonly parentCols: readonly string[];
    readonly childCols: readonly string[];
  };
};

export interface ModelBuilderState<
  Name extends string,
  Table extends string,
  Fields extends Record<string, string>,
  Relations extends Record<string, RelationDefinition>,
> {
  readonly name: Name;
  readonly table: Table;
  readonly fields: Fields;
  readonly relations: Relations;
}

export interface ContractBuilderState<
  Target extends string | undefined = string | undefined,
  Tables extends Record<
    string,
    TableBuilderState<
      string,
      Record<string, ColumnBuilderState<string, boolean, string>>,
      readonly string[] | undefined
    >
  > = Record<
    never,
    TableBuilderState<
      string,
      Record<string, ColumnBuilderState<string, boolean, string>>,
      readonly string[] | undefined
    >
  >,
  Models extends Record<
    string,
    ModelBuilderState<string, string, Record<string, string>, Record<string, RelationDefinition>>
  > = Record<
    never,
    ModelBuilderState<string, string, Record<string, string>, Record<string, RelationDefinition>>
  >,
  CoreHash extends string | undefined = string | undefined,
  ExtensionPacks extends Record<string, unknown> | undefined = undefined,
  Capabilities extends Record<string, Record<string, boolean>> | undefined = undefined,
> {
  readonly target?: Target;
  readonly tables: Tables;
  readonly models: Models;
  readonly coreHash?: CoreHash;
  readonly extensionPacks?: ExtensionPacks;
  readonly capabilities?: Capabilities;
  /**
   * Array of extension pack namespace identifiers (e.g., ['pgvector', 'postgis']).
   * Populated when extension packs are registered during contract building.
   * Used to track which extension packs are included in the contract.
   * Can be undefined or empty if no extension packs are registered.
   * Namespace format matches the extension pack ID (e.g., 'pgvector', not 'pgvector@1.0.0').
   */
  readonly extensionNamespaces?: readonly string[];
}

export interface ColumnBuilder<Name extends string, Nullable extends boolean, Type extends string> {
  nullable<Value extends boolean>(value?: Value): ColumnBuilder<Name, Value, Type>;
  type<Id extends string>(id: Id): ColumnBuilder<Name, Nullable, Id>;
  build(): ColumnBuilderState<Name, Nullable, Type>;
}
