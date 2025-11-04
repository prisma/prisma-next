import type {
  SqlContract,
  SqlStorage,
  ModelDefinition,
  ModelField,
  StorageColumn,
  StorageTable,
  SqlMappings,
} from './contract-types';
import { computeMappings } from './contract';

export interface ColumnOptions {
  nullable?: boolean;
  typeId?: string;
}

type CanonicalizeType<
  Scalar extends string,
  Target extends string,
> = Scalar extends `pg/${infer _}@${infer _}`
  ? Scalar
  : Target extends 'postgres'
    ? `pg/${Scalar}@1`
    : Scalar;

type BuildStorageColumn<
  Scalar extends string,
  Nullable extends boolean,
  TypeId extends string | undefined,
  Target extends string,
> = {
  readonly type: TypeId extends string ? TypeId : CanonicalizeType<Scalar, Target>;
  readonly nullable: Nullable;
};

type BuildStorageTable<
  _TableName extends string,
  Columns extends Record<string, { scalar: string; nullable: boolean; typeId?: string }>,
  PK extends readonly string[] | undefined,
  Target extends string,
> = {
  readonly columns: {
    readonly [K in keyof Columns]: BuildStorageColumn<
      Columns[K]['scalar'] & string,
      Columns[K]['nullable'] & boolean,
      Columns[K]['typeId'],
      Target
    >;
  };
} & (PK extends readonly string[] ? { readonly primaryKey: { readonly columns: PK } } : {});

type ExtractColumns<T extends TableBuilderState<any, any, any>> =
  T extends TableBuilderState<any, infer C, any> ? C : never;

type ExtractPrimaryKey<T extends TableBuilderState<any, any, any>> =
  T extends TableBuilderState<any, any, infer PK> ? PK : never;

type NormalizeColumns<C extends Record<string, ColumnBuilderState<any, any, any, any>>> = {
  [K in keyof C]: C[K] extends ColumnBuilderState<any, infer S, infer Null, infer TId>
    ? { scalar: S & string; nullable: Null & boolean; typeId: TId }
    : never;
};

type BuildStorage<
  Tables extends Record<string, TableBuilderState<string, any, any>>,
  Target extends string,
> = {
  readonly tables: {
    readonly [K in keyof Tables]: BuildStorageTable<
      K & string,
      NormalizeColumns<ExtractColumns<Tables[K]>> &
        Record<string, { scalar: string; nullable: boolean; typeId?: string }>,
      ExtractPrimaryKey<Tables[K]>,
      Target
    >;
  };
};

type BuildModelFields<Fields extends Record<string, string>> = {
  readonly [K in keyof Fields]: { readonly column: Fields[K] };
};

type ExtractModelFields<T extends ModelBuilderState<any, any, any>> =
  T extends ModelBuilderState<any, any, infer F> ? F : never;

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
  TypeId extends string | undefined = string | undefined,
> {
  readonly name: Name;
  readonly scalar: Scalar;
  readonly nullable: Nullable;
  readonly typeId: TypeId;
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

export class ColumnBuilder<
  Name extends string,
  Scalar extends string,
  Nullable extends boolean = false,
  TypeId extends string | undefined = undefined,
> {
  private readonly _name: Name;
  private readonly _scalar: Scalar;
  private readonly _nullable: Nullable;
  private readonly _typeId: TypeId;

  constructor(name: Name, scalar: Scalar, nullable: Nullable = false as Nullable, typeId?: TypeId) {
    this._name = name;
    this._scalar = scalar;
    this._nullable = nullable;
    this._typeId = typeId as TypeId;
  }

  nullable<Value extends boolean>(
    value: Value = true as Value,
  ): ColumnBuilder<Name, Scalar, Value, TypeId> {
    return new ColumnBuilder(this._name, this._scalar, value, this._typeId);
  }

  typeId<Id extends string>(id: Id): ColumnBuilder<Name, Scalar, Nullable, Id> {
    if (typeof id !== 'string' || !id.includes('@')) {
      throw new Error(`typeId must be in format "namespace/name@version", got "${id}"`);
    }
    return new ColumnBuilder(this._name, this._scalar, this._nullable, id);
  }

  build(): ColumnBuilderState<Name, Scalar, Nullable, TypeId> {
    return {
      name: this._name,
      scalar: this._scalar,
      nullable: this._nullable,
      typeId: this._typeId,
    };
  }
}

class TableBuilder<
  Name extends string,
  Columns extends Record<
    string,
    ColumnBuilderState<string, string, boolean, string | undefined>
  > = Record<string, ColumnBuilderState<string, string, boolean, string | undefined>>,
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
    Options extends ColumnOptions | undefined = undefined,
  >(
    name: ColName,
    scalar: Scalar,
    options?: Options,
  ): TableBuilder<
    Name,
    Columns &
      Record<
        ColName,
        ColumnBuilderState<
          ColName,
          Scalar,
          Options extends { nullable: true } ? true : false,
          Options extends { typeId: infer T } ? (T extends string ? T : undefined) : undefined
        >
      >,
    PrimaryKey
  > {
    if (options?.typeId) {
      if (typeof options.typeId !== 'string' || !options.typeId.includes('@')) {
        throw new Error(
          `typeId must be in format "namespace/name@version", got "${options.typeId}"`,
        );
      }
    }
    const nullable = (options?.nullable ?? false) as Options extends { nullable: true }
      ? true
      : false;
    const typeId = options?.typeId as Options extends { typeId: infer T }
      ? T extends string
        ? T
        : undefined
      : undefined as Options extends { typeId: infer T }
      ? T extends string
        ? T
        : undefined
      : undefined;
    const columnState = {
      name,
      scalar,
      nullable,
      typeId,
    } as ColumnBuilderState<
      ColName,
      Scalar,
      Options extends { nullable: true } ? true : false,
      Options extends { typeId: infer T } ? (T extends string ? T : undefined) : undefined
    >;
    return new TableBuilder(
      this._name,
      { ...this._columns, [name]: columnState } as Columns &
        Record<
          ColName,
          ColumnBuilderState<
            ColName,
            Scalar,
            Options extends { nullable: true } ? true : false,
            Options extends { typeId: infer T } ? (T extends string ? T : undefined) : undefined
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
  Fields extends Record<string, string> = Record<string, string>,
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
> {
  readonly target?: Target;
  readonly tables: Tables;
  readonly models: Models;
  readonly coreHash?: CoreHash;
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
  CoreHash extends string | undefined = undefined,
> {
  private readonly state: ContractBuilderState<Target, Tables, Models, CoreHash>;

  constructor(state?: ContractBuilderState<Target, Tables, Models, CoreHash>) {
    this.state =
      state ??
      ({
        tables: {},
        models: {},
      } as ContractBuilderState<Target, Tables, Models, CoreHash>);
  }

  target<T extends string>(target: T): ContractBuilder<CodecTypes, T, Tables, Models, CoreHash> {
    return new ContractBuilder<CodecTypes, T, Tables, Models, CoreHash>({
      ...this.state,
      target,
    });
  }

  table<TableName extends string, T extends TableBuilder<TableName, any, any>>(
    name: TableName,
    callback: (t: TableBuilder<TableName>) => T | void,
  ): ContractBuilder<
    CodecTypes,
    Target,
    Tables & Record<TableName, ReturnType<T['build']>>,
    Models,
    CoreHash
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
      CoreHash
    >({
      ...this.state,
      tables: { ...this.state.tables, [name]: tableState } as Tables &
        Record<TableName, ReturnType<T['build']>>,
    });
  }

  model<
    ModelName extends string,
    TableName extends string,
    M extends ModelBuilder<ModelName, TableName, any>,
  >(
    name: ModelName,
    table: TableName,
    callback: (m: ModelBuilder<ModelName, TableName>) => M | void,
  ): ContractBuilder<
    CodecTypes,
    Target,
    Tables,
    Models & Record<ModelName, ReturnType<M['build']>>,
    CoreHash
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
      CoreHash
    >({
      ...this.state,
      models: { ...this.state.models, [name]: modelState } as Models &
        Record<ModelName, ReturnType<M['build']>>,
    });
  }

  coreHash<H extends string>(hash: H): ContractBuilder<CodecTypes, Target, Tables, Models, H> {
    return new ContractBuilder<CodecTypes, Target, Tables, Models, H>({
      ...this.state,
      coreHash: hash,
    });
  }

  build(): Target extends string
    ? SqlContract<BuildStorage<Tables, Target & string>, BuildModels<Models>, {}, SqlMappings> & {
        readonly schemaVersion: '1';
        readonly target: Target;
        readonly targetFamily: 'sql';
        readonly coreHash: CoreHash extends string ? CoreHash : string;
      }
    : never {
    if (!this.state.target) {
      throw new Error('target is required. Call .target() before .build()');
    }

    const target = this.state.target as Target & string;
    const storageRuntime: { tables: Record<string, StorageTable> } = { tables: {} };
    const modelsRuntime: Record<string, ModelDefinition> = {};
    const extensions: Record<string, unknown> = {};

    for (const [tableName, tableState] of Object.entries(this.state.tables)) {
      const columns = {} as Record<string, StorageColumn>;
      const columnDecorations: Array<{
        ref: { kind: string; table: string; column: string };
        payload?: { typeId?: string };
      }> = [];

      const tableStateTyped = tableState as unknown as {
        columns: Record<string, ColumnBuilderState>;
        primaryKey?: readonly string[] | { columns: readonly string[] };
      };

      for (const [columnName, columnState] of Object.entries(tableStateTyped.columns)) {
        const scalar = columnState.scalar;
        const typeId =
          columnState.typeId ||
          (scalar.includes('/') && scalar.includes('@') ? scalar : `pg/${scalar}@1`);
        const column: StorageColumn = {
          type: typeId,
          nullable: columnState.nullable ?? false,
        };
        columns[columnName] = column;

        if (columnState.typeId) {
          columnDecorations.push({
            ref: {
              kind: 'column',
              table: tableName,
              column: columnName,
            },
            payload: {
              typeId: columnState.typeId,
            },
          });
        }
      }

      const primaryKeyColumns = tableStateTyped.primaryKey
        ? Array.isArray(tableStateTyped.primaryKey)
          ? tableStateTyped.primaryKey
          : 'columns' in tableStateTyped.primaryKey
            ? tableStateTyped.primaryKey.columns
            : undefined
        : undefined;

      const table: StorageTable = {
        columns,
        ...(primaryKeyColumns
          ? {
              primaryKey: {
                columns: primaryKeyColumns,
              },
            }
          : {}),
      };

      storageRuntime.tables[tableName] = table;

      if (columnDecorations.length > 0) {
        if (!extensions['core']) {
          extensions['core'] = {};
        }
        const coreExt = extensions['core'] as {
          decorations?: {
            columns?: Array<{
              ref: { kind: string; table: string; column: string };
              payload?: { typeId?: string };
            }>;
          };
        };
        if (!coreExt.decorations) {
          coreExt.decorations = {};
        }
        if (!coreExt.decorations.columns) {
          coreExt.decorations.columns = [];
        }
        coreExt.decorations.columns.push(...columnDecorations);
      }
    }

    for (const [modelName, modelState] of Object.entries(this.state.models)) {
      const fields: Record<string, ModelField> = {};
      const modelStateTyped = modelState as { table: string; fields: Record<string, string> };

      for (const [fieldName, columnName] of Object.entries(modelStateTyped.fields)) {
        fields[fieldName] = {
          column: columnName,
        };
      }

      modelsRuntime[modelName] = {
        storage: {
          table: modelStateTyped.table,
        },
        fields,
      };
    }

    const mappings = computeMappings(modelsRuntime, storageRuntime as SqlStorage);

    const contract = {
      schemaVersion: '1' as const,
      target,
      targetFamily: 'sql' as const,
      coreHash: this.state.coreHash || `sha256:ts-builder-placeholder`,
      models: modelsRuntime,
      relations: {},
      storage: storageRuntime,
      mappings,
      ...(Object.keys(extensions).length > 0 ? { extensions } : {}),
    } as SqlContract<
      BuildStorage<Tables, Target & string>,
      BuildModels<Models>,
      {},
      SqlMappings
    > & {
      readonly schemaVersion: '1';
      readonly target: Target;
      readonly targetFamily: 'sql';
      readonly coreHash: CoreHash extends string ? CoreHash : string;
    };

    return contract as Target extends string
      ? SqlContract<BuildStorage<Tables, Target & string>, BuildModels<Models>, {}, SqlMappings> & {
          readonly schemaVersion: '1';
          readonly target: Target;
          readonly targetFamily: 'sql';
          readonly coreHash: CoreHash extends string ? CoreHash : string;
        }
      : never;
  }
}

export function defineContract<
  CodecTypes extends Record<string, { output: unknown }> = Record<string, never>,
>(): ContractBuilder<CodecTypes> {
  return new ContractBuilder<CodecTypes>();
}
