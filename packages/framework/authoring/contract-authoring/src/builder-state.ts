export interface ColumnBuilderState<
  Name extends string,
  Nullable extends boolean,
  Type extends string,
> {
  readonly name: Name;
  readonly nullable: Nullable;
  readonly type: Type;
}

export interface TableBuilderState<
  Name extends string,
  Columns extends Record<string, ColumnBuilderState<string, boolean, string>>,
  PrimaryKey extends readonly string[] | undefined,
> {
  readonly name: Name;
  readonly columns: Columns;
  readonly primaryKey?: PrimaryKey;
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
  Extensions extends Record<string, unknown> | undefined = undefined,
  Capabilities extends Record<string, Record<string, boolean>> | undefined = undefined,
> {
  readonly target?: Target;
  readonly tables: Tables;
  readonly models: Models;
  readonly coreHash?: CoreHash;
  readonly extensions?: Extensions;
  readonly capabilities?: Capabilities;
}

export interface ColumnBuilder<Name extends string, Nullable extends boolean, Type extends string> {
  nullable<Value extends boolean>(value?: Value): ColumnBuilder<Name, Value, Type>;
  type<Id extends string>(id: Id): ColumnBuilder<Name, Nullable, Id>;
  build(): ColumnBuilderState<Name, Nullable, Type>;
}
