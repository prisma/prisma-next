import type {
  ModelDefinition,
  ModelField,
  SqlContract,
  SqlMappings,
  SqlStorage,
  StorageColumn,
  StorageTable,
} from '@prisma-next/sql-target';
import { computeMappings } from './contract';

export interface ColumnOptions<TType extends string = string> {
  nullable?: boolean;
  type?: TType;
}

type CanonicalizeType<
  Scalar extends string,
  Target extends string,
> = Scalar extends `pg/${infer _Scalar}@${infer _Version}`
  ? Scalar
  : Target extends 'postgres'
    ? `pg/${Scalar}@1`
    : Scalar;

type BuildStorageColumn<
  Scalar extends string,
  Nullable extends boolean,
  Type extends string | undefined,
  Target extends string,
> = {
  readonly type: Type extends string ? Type : CanonicalizeType<Scalar, Target>;
  readonly nullable: Nullable;
};

type BuildStorageTable<
  _TableName extends string,
  Columns extends Record<string, { scalar: string; nullable: boolean; type?: unknown }>,
  PK extends readonly string[] | undefined,
  Target extends string,
> = {
  readonly columns: {
    readonly [K in keyof Columns]: Columns[K] extends { type: infer TType }
      ? TType extends string
        ? BuildStorageColumn<
            Columns[K]['scalar'] & string,
            Columns[K]['nullable'] & boolean,
            TType,
            Target
          >
        : BuildStorageColumn<
            Columns[K]['scalar'] & string,
            Columns[K]['nullable'] & boolean,
            undefined,
            Target
          >
      : BuildStorageColumn<
          Columns[K]['scalar'] & string,
          Columns[K]['nullable'] & boolean,
          undefined,
          Target
        >;
  };
} & (PK extends readonly string[]
  ? { readonly primaryKey: { readonly columns: PK } }
  : Record<string, never>);

type ExtractColumns<
  T extends TableBuilderState<
    string,
    Record<string, ColumnBuilderState<string, string, boolean, string | undefined>>,
    readonly string[] | undefined
  >,
> = T extends TableBuilderState<string, infer C, readonly string[] | undefined> ? C : never;

type ExtractPrimaryKey<
  T extends TableBuilderState<
    string,
    Record<string, ColumnBuilderState<string, string, boolean, string | undefined>>,
    readonly string[] | undefined
  >,
> = T extends TableBuilderState<
  string,
  Record<string, ColumnBuilderState<string, string, boolean, string | undefined>>,
  infer PK
>
  ? PK
  : never;

type NormalizeColumns<
  C extends Record<string, ColumnBuilderState<string, string, boolean, string | undefined>>,
> = {
  [K in keyof C]: C[K] extends ColumnBuilderState<string, infer S, infer Null, infer TType>
    ? { scalar: S & string; nullable: Null & boolean; type: TType }
    : never;
};

type BuildStorage<
  Tables extends Record<
    string,
    TableBuilderState<
      string,
      Record<string, ColumnBuilderState<string, string, boolean, string | undefined>>,
      readonly string[] | undefined
    >
  >,
  Target extends string,
> = {
  readonly tables: {
    readonly [K in keyof Tables]: BuildStorageTable<
      K & string,
      NormalizeColumns<ExtractColumns<Tables[K]>>,
      ExtractPrimaryKey<Tables[K]>,
      Target
    >;
  };
};

type BuildModelFields<Fields extends Record<string, string>> = {
  readonly [K in keyof Fields]: { readonly column: Fields[K] };
};

type ExtractModelFields<T extends ModelBuilderState<string, string, Record<string, string>>> =
  T extends ModelBuilderState<string, string, infer F> ? F : never;

type BuildModels<
  Models extends Record<string, ModelBuilderState<string, string, Record<string, string>>>,
> = {
  readonly [K in keyof Models]: {
    readonly storage: { readonly table: Models[K]['table'] };
    readonly fields: BuildModelFields<ExtractModelFields<Models[K]>>;
  };
};

interface ColumnBuilderState<
  Name extends string = string,
  Scalar extends string = string,
  Nullable extends boolean = boolean,
  Type extends string | undefined = string | undefined,
> {
  readonly name: Name;
  readonly scalar: Scalar;
  readonly nullable: Nullable;
  readonly type: Type;
}

interface TableBuilderState<
  Name extends string = string,
  Columns extends Record<
    string,
    ColumnBuilderState<string, string, boolean, string | undefined>
  > = Record<string, ColumnBuilderState<string, string, boolean, string | undefined>>,
  PrimaryKey extends readonly string[] | undefined = undefined,
> {
  readonly name: Name;
  readonly columns: Columns;
  readonly primaryKey?: PrimaryKey;
}

interface ModelBuilderState<
  Name extends string = string,
  Table extends string = string,
  Fields extends Record<string, string> = Record<string, string>,
> {
  readonly name: Name;
  readonly table: Table;
  readonly fields: Fields;
}

export interface ColumnBuilder<
  Name extends string,
  Scalar extends string,
  Nullable extends boolean = false,
  Type extends string | undefined = undefined,
> {
  nullable<Value extends boolean>(value?: Value): ColumnBuilder<Name, Scalar, Value, Type>;
  type<Id extends string>(id: Id): ColumnBuilder<Name, Scalar, Nullable, Id>;
  build(): ColumnBuilderState<Name, Scalar, Nullable, Type>;
}

class TableBuilder<
  Name extends string,
  Columns extends Record<
    string,
    ColumnBuilderState<string, string, boolean, string | undefined>
  > = Record<string, never>,
  PrimaryKey extends readonly string[] | undefined = undefined,
> {
  private readonly _name: Name;
  private readonly _columns: Columns;
  private readonly _primaryKey: PrimaryKey;

  constructor(name: Name, columns: Columns = {} as Columns, primaryKey?: PrimaryKey) {
    this._name = name;
    this._columns = columns;
    this._primaryKey = primaryKey as PrimaryKey;
  }

  column<
    ColName extends string,
    Scalar extends string,
    TOptions extends { nullable?: boolean; type?: string } | undefined = undefined,
  >(
    name: ColName,
    scalar: Scalar,
    options?: TOptions,
  ): TableBuilder<
    Name,
    Columns &
      Record<
        ColName,
        ColumnBuilderState<
          ColName,
          Scalar,
          TOptions extends { nullable: true } ? true : false,
          TOptions extends { type: infer TType }
            ? TType extends string
              ? TType
              : undefined
            : undefined
        >
      >,
    PrimaryKey
  > {
    if (options?.type) {
      if (typeof options.type !== 'string' || !options.type.includes('@')) {
        throw new Error(`type must be in format "namespace/name@version", got "${options.type}"`);
      }
    }
    const nullable = (options?.nullable ?? false) as TOptions extends { nullable: true }
      ? true
      : false;
    const type = options?.type;
    const columnState = {
      name,
      scalar,
      nullable,
      type,
    } as ColumnBuilderState<
      ColName,
      Scalar,
      TOptions extends { nullable: true } ? true : false,
      TOptions extends { type: infer TType }
        ? TType extends string
          ? TType
          : undefined
        : undefined
    >;
    return new TableBuilder(
      this._name,
      { ...this._columns, [name]: columnState } as Columns &
        Record<
          ColName,
          ColumnBuilderState<
            ColName,
            Scalar,
            TOptions extends { nullable: true } ? true : false,
            TOptions extends { type: infer TType }
              ? TType extends string
                ? TType
                : undefined
              : undefined
          >
        >,
      this._primaryKey,
    );
  }

  primaryKey<PK extends readonly string[]>(
    columns: PK,
    _name?: string,
  ): TableBuilder<Name, Columns, PK> {
    return new TableBuilder(this._name, this._columns, columns);
  }

  unique(_columns: readonly string[], _name?: string): TableBuilder<Name, Columns, PrimaryKey> {
    return this;
  }

  index(_columns: readonly string[], _name?: string): TableBuilder<Name, Columns, PrimaryKey> {
    return this;
  }

  foreignKey(
    _columns: readonly string[],
    _references: { table: string; columns: readonly string[] },
    _name?: string,
  ): TableBuilder<Name, Columns, PrimaryKey> {
    return this;
  }

  build(): TableBuilderState<Name, Columns, PrimaryKey> {
    return {
      name: this._name,
      columns: this._columns,
      ...(this._primaryKey !== undefined ? { primaryKey: this._primaryKey } : {}),
    } as TableBuilderState<Name, Columns, PrimaryKey>;
  }
}

class ModelBuilder<
  Name extends string,
  Table extends string,
  Fields extends Record<string, string> = Record<string, never>,
> {
  private readonly _name: Name;
  private readonly _table: Table;
  private readonly _fields: Fields;

  constructor(name: Name, table: Table, fields: Fields = {} as Fields) {
    this._name = name;
    this._table = table;
    this._fields = fields;
  }

  field<FieldName extends string, ColumnName extends string>(
    fieldName: FieldName,
    columnName: ColumnName,
  ): ModelBuilder<Name, Table, Fields & Record<FieldName, ColumnName>> {
    return new ModelBuilder(this._name, this._table, {
      ...this._fields,
      [fieldName]: columnName,
    } as Fields & Record<FieldName, ColumnName>);
  }

  build(): ModelBuilderState<Name, Table, Fields> {
    return {
      name: this._name,
      table: this._table,
      fields: this._fields,
    };
  }
}

interface ContractBuilderState<
  Target extends string | undefined = string | undefined,
  Tables extends Record<
    string,
    TableBuilderState<
      string,
      Record<string, ColumnBuilderState<string, string, boolean, string | undefined>>,
      readonly string[] | undefined
    >
  > = Record<
    string,
    TableBuilderState<
      string,
      Record<string, ColumnBuilderState<string, string, boolean, string | undefined>>,
      readonly string[] | undefined
    >
  >,
  Models extends Record<string, ModelBuilderState<string, string, Record<string, string>>> = Record<
    string,
    ModelBuilderState<string, string, Record<string, string>>
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

class ContractBuilder<
  CodecTypes extends Record<string, { output: unknown }> = Record<string, never>,
  Target extends string | undefined = undefined,
  Tables extends Record<
    string,
    TableBuilderState<
      string,
      Record<string, ColumnBuilderState<string, string, boolean, string | undefined>>,
      readonly string[] | undefined
    >
  > = Record<string, never>,
  Models extends Record<string, ModelBuilderState<string, string, Record<string, string>>> = Record<
    string,
    never
  >,
  CoreHash extends string | undefined = undefined,
  Extensions extends Record<string, unknown> | undefined = undefined,
  Capabilities extends Record<string, Record<string, boolean>> | undefined = undefined,
> {
  private readonly state: ContractBuilderState<Target, Tables, Models, CoreHash, Extensions, Capabilities>;

  constructor(state?: ContractBuilderState<Target, Tables, Models, CoreHash, Extensions, Capabilities>) {
    this.state =
      state ??
      ({
        tables: {},
        models: {},
      } as ContractBuilderState<Target, Tables, Models, CoreHash, Extensions, Capabilities>);
  }

  target<T extends string>(
    target: T,
  ): ContractBuilder<CodecTypes, T, Tables, Models, CoreHash, Extensions, Capabilities> {
    return new ContractBuilder<CodecTypes, T, Tables, Models, CoreHash, Extensions, Capabilities>({
      ...this.state,
      target,
    });
  }

  extensions<E extends Record<string, unknown>>(
    extensions: E,
  ): ContractBuilder<CodecTypes, Target, Tables, Models, CoreHash, E, Capabilities> {
    return new ContractBuilder<CodecTypes, Target, Tables, Models, CoreHash, E, Capabilities>({
      ...this.state,
      extensions,
    });
  }

  capabilities<C extends Record<string, Record<string, boolean>>>(
    capabilities: C,
  ): ContractBuilder<CodecTypes, Target, Tables, Models, CoreHash, Extensions, C> {
    return new ContractBuilder<CodecTypes, Target, Tables, Models, CoreHash, Extensions, C>({
      ...this.state,
      capabilities,
    });
  }

  table<
    TableName extends string,
    T extends TableBuilder<
      TableName,
      Record<string, ColumnBuilderState<string, string, boolean, string | undefined>>,
      readonly string[] | undefined
    >,
  >(
    name: TableName,
    callback: (t: TableBuilder<TableName>) => T | undefined,
  ): ContractBuilder<
    CodecTypes,
    Target,
    Tables & Record<TableName, ReturnType<T['build']>>,
    Models,
    CoreHash,
    Extensions,
    Capabilities
  > {
    const tableBuilder = new TableBuilder<TableName>(name);
    const result = callback(tableBuilder);
    const finalBuilder = result instanceof TableBuilder ? result : tableBuilder;
    const tableState = finalBuilder.build();

    return new ContractBuilder<
      CodecTypes,
      Target,
      Tables & Record<TableName, ReturnType<T['build']>>,
      Models,
      CoreHash,
      Extensions,
      Capabilities
    >({
      ...this.state,
      tables: { ...this.state.tables, [name]: tableState } as Tables &
        Record<TableName, ReturnType<T['build']>>,
    });
  }

  model<
    ModelName extends string,
    TableName extends string,
    M extends ModelBuilder<ModelName, TableName, Record<string, string>>,
  >(
    name: ModelName,
    table: TableName,
    callback: (m: ModelBuilder<ModelName, TableName>) => M | undefined,
  ): ContractBuilder<
    CodecTypes,
    Target,
    Tables,
    Models & Record<ModelName, ReturnType<M['build']>>,
    CoreHash,
    Extensions,
    Capabilities
  > {
    const modelBuilder = new ModelBuilder<ModelName, TableName>(name, table);
    const result = callback(modelBuilder);
    const finalBuilder = result instanceof ModelBuilder ? result : modelBuilder;
    const modelState = finalBuilder.build();

    return new ContractBuilder<
      CodecTypes,
      Target,
      Tables,
      Models & Record<ModelName, ReturnType<M['build']>>,
      CoreHash,
      Extensions,
      Capabilities
    >({
      ...this.state,
      models: { ...this.state.models, [name]: modelState } as Models &
        Record<ModelName, ReturnType<M['build']>>,
    });
  }

  coreHash<H extends string>(
    hash: H,
  ): ContractBuilder<CodecTypes, Target, Tables, Models, H, Extensions, Capabilities> {
    return new ContractBuilder<CodecTypes, Target, Tables, Models, H, Extensions, Capabilities>({
      ...this.state,
      coreHash: hash,
    });
  }

  build(): Target extends string
    ? SqlContract<
        BuildStorage<Tables, Target & string>,
        BuildModels<Models>,
        Record<string, never>,
        SqlMappings
      > & {
        readonly schemaVersion: '1';
        readonly target: Target;
        readonly targetFamily: 'sql';
        readonly coreHash: CoreHash extends string ? CoreHash : string;
      } & (Extensions extends Record<string, unknown>
          ? { readonly extensions: Extensions }
          : Record<string, never>) &
        (Capabilities extends Record<string, Record<string, boolean>>
          ? { readonly capabilities: Capabilities }
          : Record<string, never>)
    : never {
    // Type helper to ensure literal types are preserved in return type
    type BuiltContract = Target extends string
      ? SqlContract<
          BuildStorage<Tables, Target & string>,
          BuildModels<Models>,
          Record<string, never>,
          SqlMappings
        > & {
          readonly schemaVersion: '1';
          readonly target: Target;
          readonly targetFamily: 'sql';
          readonly coreHash: CoreHash extends string ? CoreHash : string;
        } & (Extensions extends Record<string, unknown>
            ? { readonly extensions: Extensions }
            : Record<string, never>) &
          (Capabilities extends Record<string, Record<string, boolean>>
            ? { readonly capabilities: Capabilities }
            : Record<string, never>)
      : never;
    if (!this.state.target) {
      throw new Error('target is required. Call .target() before .build()');
    }

    const target = this.state.target as Target & string;

    // Build storage tables - construct as partial first, then assert full type
    const storageTables: Partial<BuildStorage<Tables, Target & string>['tables']> = {};

    // Iterate over tables - TypeScript will see keys as string, but type assertion preserves literals
    for (const tableName in this.state.tables) {
      const tableState = this.state.tables[tableName];
      if (!tableState) continue;

      const tableStateTyped = tableState as unknown as {
        name: string;
        columns: Record<string, ColumnBuilderState>;
        primaryKey?: readonly string[] | { columns: readonly string[] };
      };

      // Build columns object
      const columns: Partial<Record<string, StorageColumn>> = {};

      // Iterate over columns
      for (const columnName in tableStateTyped.columns) {
        const columnState = tableStateTyped.columns[columnName];
        if (!columnState) continue;

        const scalar = columnState.scalar;
        const type =
          columnState.type ||
          (scalar.includes('/') && scalar.includes('@') ? scalar : `pg/${scalar}@1`);
        const column: StorageColumn = {
          type: type,
          nullable: columnState.nullable ?? false,
        };
        columns[columnName] = column;
      }

      const primaryKeyColumns = tableStateTyped.primaryKey
        ? Array.isArray(tableStateTyped.primaryKey)
          ? tableStateTyped.primaryKey
          : 'columns' in tableStateTyped.primaryKey
            ? tableStateTyped.primaryKey.columns
            : undefined
        : undefined;

      const table: StorageTable = {
        columns: columns as Record<string, StorageColumn>,
        ...(primaryKeyColumns
          ? {
              primaryKey: {
                columns: primaryKeyColumns,
              },
            }
          : {}),
      };

      // Assign to storage tables - type assertion preserves literal keys
      (storageTables as Record<string, StorageTable>)[tableName] = table;
    }

    // Build models - construct as partial first, then assert full type
    const modelsPartial: Partial<BuildModels<Models>> = {};

    // Iterate over models - TypeScript will see keys as string, but type assertion preserves literals
    for (const modelName in this.state.models) {
      const modelState = this.state.models[modelName];
      if (!modelState) continue;

      const modelStateTyped = modelState as unknown as {
        name: string;
        table: string;
        fields: Record<string, string>;
      };

      // Build fields object
      const fields: Partial<Record<string, ModelField>> = {};

      // Iterate over fields
      for (const fieldName in modelStateTyped.fields) {
        const columnName = modelStateTyped.fields[fieldName];
        if (columnName) {
          fields[fieldName] = {
            column: columnName,
          };
        }
      }

      // Assign to models - type assertion preserves literal keys
      (modelsPartial as Record<string, ModelDefinition>)[modelName] = {
        storage: {
          table: modelStateTyped.table,
        },
        fields: fields as Record<string, ModelField>,
      };
    }

    // Type assertions to preserve literal types from generics
    // The type system knows these match BuildStorage/BuildModels from the generics
    const storage = { tables: storageTables } as unknown as BuildStorage<Tables, Target & string>;
    const models = modelsPartial as unknown as BuildModels<Models>;

    const mappings = computeMappings(
      models as Record<string, ModelDefinition>,
      storage as SqlStorage,
    );

    // Construct contract with explicit type that matches the generic parameters
    // This ensures TypeScript infers literal types from the generics, not runtime values
    const contract = {
      schemaVersion: '1' as const,
      target,
      targetFamily: 'sql' as const,
      coreHash: this.state.coreHash || 'sha256:ts-builder-placeholder',
      models,
      relations: {},
      storage,
      mappings,
      ...(this.state.extensions ? { extensions: this.state.extensions } : {}),
      ...(this.state.capabilities ? { capabilities: this.state.capabilities } : {}),
    } as unknown as BuiltContract;

    return contract as BuiltContract;
  }
}

export function defineContract<
  CodecTypes extends Record<string, { output: unknown }> = Record<string, never>,
>(): ContractBuilder<CodecTypes> {
  return new ContractBuilder<CodecTypes>();
}
