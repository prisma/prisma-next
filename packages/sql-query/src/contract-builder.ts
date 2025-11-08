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

type BuildStorageColumn<Nullable extends boolean, Type extends string> = {
  readonly type: Type;
  readonly nullable: Nullable;
};

type BuildStorageTable<
  _TableName extends string,
  Columns extends Record<string, ColumnBuilderState<string, boolean, string>>,
  PK extends readonly string[] | undefined,
> = {
  readonly columns: {
    readonly [K in keyof Columns]: Columns[K] extends ColumnBuilderState<
      string,
      infer Null,
      infer TType
    >
      ? BuildStorageColumn<Null & boolean, TType>
      : never;
  };
  readonly uniques: ReadonlyArray<never>;
  readonly indexes: ReadonlyArray<never>;
  readonly foreignKeys: ReadonlyArray<never>;
} & (PK extends readonly string[]
  ? { readonly primaryKey: { readonly columns: PK } }
  : Record<string, never>);

type ExtractColumns<
  T extends TableBuilderState<
    string,
    Record<string, ColumnBuilderState<string, boolean, string>>,
    readonly string[] | undefined
  >,
> = T extends TableBuilderState<string, infer C, readonly string[] | undefined> ? C : never;

type ExtractPrimaryKey<
  T extends TableBuilderState<
    string,
    Record<string, ColumnBuilderState<string, boolean, string>>,
    readonly string[] | undefined
  >,
> = T extends TableBuilderState<
  string,
  Record<string, ColumnBuilderState<string, boolean, string>>,
  infer PK
>
  ? PK
  : never;

type BuildStorage<
  Tables extends Record<
    string,
    TableBuilderState<
      string,
      Record<string, ColumnBuilderState<string, boolean, string>>,
      readonly string[] | undefined
    >
  >,
> = {
  readonly tables: {
    readonly [K in keyof Tables]: BuildStorageTable<
      K & string,
      ExtractColumns<Tables[K]>,
      ExtractPrimaryKey<Tables[K]>
    >;
  };
};

type BuildModelFields<Fields extends Record<string, string>> = {
  readonly [K in keyof Fields]: { readonly column: Fields[K] };
};

type ExtractModelFields<
  T extends ModelBuilderState<
    string,
    string,
    Record<string, string>,
    Record<string, RelationDefinition>
  >,
> = T extends ModelBuilderState<string, string, infer F, Record<string, RelationDefinition>>
  ? F
  : never;

type ExtractModelRelations<
  T extends ModelBuilderState<
    string,
    string,
    Record<string, string>,
    Record<string, RelationDefinition>
  >,
> = T extends ModelBuilderState<string, string, Record<string, string>, infer R> ? R : never;

type BuildModels<
  Models extends Record<
    string,
    ModelBuilderState<string, string, Record<string, string>, Record<string, RelationDefinition>>
  >,
> = {
  readonly [K in keyof Models]: {
    readonly storage: { readonly table: Models[K]['table'] };
    readonly fields: BuildModelFields<ExtractModelFields<Models[K]>>;
  };
};

type BuildRelations<
  Models extends Record<
    string,
    ModelBuilderState<string, string, Record<string, string>, Record<string, RelationDefinition>>
  >,
> = {
  readonly [K in keyof Models as Models[K]['table']]: ExtractModelRelations<Models[K]>;
};

interface ColumnBuilderState<Name extends string, Nullable extends boolean, Type extends string> {
  readonly name: Name;
  readonly nullable: Nullable;
  readonly type: Type;
}

interface TableBuilderState<
  Name extends string,
  Columns extends Record<string, ColumnBuilderState<string, boolean, string>>,
  PrimaryKey extends readonly string[] | undefined,
> {
  readonly name: Name;
  readonly columns: Columns;
  readonly primaryKey?: PrimaryKey;
}

type RelationDefinition = {
  readonly to: string; // Target model name
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

interface ModelBuilderState<
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

export interface ColumnBuilder<Name extends string, Nullable extends boolean, Type extends string> {
  nullable<Value extends boolean>(value?: Value): ColumnBuilder<Name, Value, Type>;
  type<Id extends string>(id: Id): ColumnBuilder<Name, Nullable, Id>;
  build(): ColumnBuilderState<Name, Nullable, Type>;
}

class TableBuilder<
  Name extends string,
  Columns extends Record<string, ColumnBuilderState<string, boolean, string>> = Record<
    string,
    never
  >,
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

  column<ColName extends string, TOptions extends { type: string; nullable?: boolean }>(
    name: ColName,
    options: TOptions,
  ): TableBuilder<
    Name,
    Columns &
      Record<
        ColName,
        ColumnBuilderState<
          ColName,
          TOptions extends { nullable: true } ? true : false,
          TOptions['type'] & string
        >
      >,
    PrimaryKey
  > {
    if (!options.type || typeof options.type !== 'string' || !options.type.includes('@')) {
      throw new Error(`type must be in format "namespace/name@version", got "${options.type}"`);
    }
    const nullable = (options.nullable ?? false) as TOptions extends { nullable: true }
      ? true
      : false;
    const type = options.type;
    const columnState = {
      name,
      nullable,
      type,
    } as ColumnBuilderState<
      ColName,
      TOptions extends { nullable: true } ? true : false,
      TOptions['type'] & string
    >;
    return new TableBuilder(
      this._name,
      { ...this._columns, [name]: columnState } as Columns &
        Record<
          ColName,
          ColumnBuilderState<
            ColName,
            TOptions extends { nullable: true } ? true : false,
            TOptions['type'] & string
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
  Relations extends Record<string, RelationDefinition> = Record<string, never>,
> {
  private readonly _name: Name;
  private readonly _table: Table;
  private readonly _fields: Fields;
  private readonly _relations: Relations;

  constructor(
    name: Name,
    table: Table,
    fields: Fields = {} as Fields,
    relations: Relations = {} as Relations,
  ) {
    this._name = name;
    this._table = table;
    this._fields = fields;
    this._relations = relations;
  }

  field<FieldName extends string, ColumnName extends string>(
    fieldName: FieldName,
    columnName: ColumnName,
  ): ModelBuilder<Name, Table, Fields & Record<FieldName, ColumnName>, Relations> {
    return new ModelBuilder(
      this._name,
      this._table,
      {
        ...this._fields,
        [fieldName]: columnName,
      } as Fields & Record<FieldName, ColumnName>,
      this._relations,
    );
  }

  relation<RelationName extends string, ToModel extends string, ToTable extends string>(
    name: RelationName,
    options: {
      toModel: ToModel;
      toTable: ToTable;
      cardinality: '1:1' | '1:N' | 'N:1';
      on: {
        parentTable: Table;
        parentColumns: readonly string[];
        childTable: ToTable;
        childColumns: readonly string[];
      };
    },
  ): ModelBuilder<Name, Table, Fields, Relations & Record<RelationName, RelationDefinition>>;
  relation<
    RelationName extends string,
    ToModel extends string,
    ToTable extends string,
    JunctionTable extends string,
  >(
    name: RelationName,
    options: {
      toModel: ToModel;
      toTable: ToTable;
      cardinality: 'N:M';
      through: {
        table: JunctionTable;
        parentColumns: readonly string[];
        childColumns: readonly string[];
      };
      on: {
        parentTable: Table;
        parentColumns: readonly string[];
        childTable: JunctionTable;
        childColumns: readonly string[];
      };
    },
  ): ModelBuilder<Name, Table, Fields, Relations & Record<RelationName, RelationDefinition>>;
  relation<
    RelationName extends string,
    ToModel extends string,
    ToTable extends string,
    JunctionTable extends string = never,
  >(
    name: RelationName,
    options: {
      toModel: ToModel;
      toTable: ToTable;
      cardinality: '1:1' | '1:N' | 'N:1' | 'N:M';
      through?: {
        table: JunctionTable;
        parentColumns: readonly string[];
        childColumns: readonly string[];
      };
      on: {
        parentTable: Table;
        parentColumns: readonly string[];
        childTable: ToTable | JunctionTable;
        childColumns: readonly string[];
      };
    },
  ): ModelBuilder<Name, Table, Fields, Relations & Record<RelationName, RelationDefinition>> {
    // Validate parentTable matches model's table
    if (options.on.parentTable !== this._table) {
      throw new Error(
        `Relation "${name}" parentTable "${options.on.parentTable}" does not match model table "${this._table}"`,
      );
    }

    // Validate childTable matches toTable (for non-N:M) or through.table (for N:M)
    if (options.cardinality === 'N:M') {
      if (!options.through) {
        throw new Error(`Relation "${name}" with cardinality "N:M" requires through field`);
      }
      if (options.on.childTable !== options.through.table) {
        throw new Error(
          `Relation "${name}" childTable "${options.on.childTable}" does not match through.table "${options.through.table}"`,
        );
      }
    } else {
      if (options.on.childTable !== options.toTable) {
        throw new Error(
          `Relation "${name}" childTable "${options.on.childTable}" does not match toTable "${options.toTable}"`,
        );
      }
    }

    const relationDef: RelationDefinition = {
      to: options.toModel,
      cardinality: options.cardinality,
      on: {
        parentCols: options.on.parentColumns,
        childCols: options.on.childColumns,
      },
      ...(options.through
        ? {
            through: {
              table: options.through.table,
              parentCols: options.through.parentColumns,
              childCols: options.through.childColumns,
            },
          }
        : undefined),
    };

    return new ModelBuilder(this._name, this._table, this._fields, {
      ...this._relations,
      [name]: relationDef,
    } as Relations & Record<RelationName, RelationDefinition>);
  }

  build(): ModelBuilderState<Name, Table, Fields, Relations> {
    return {
      name: this._name,
      table: this._table,
      fields: this._fields,
      relations: this._relations,
    };
  }
}

interface ContractBuilderState<
  Target extends string | undefined = string | undefined,
  Tables extends Record<
    string,
    TableBuilderState<
      string,
      Record<string, ColumnBuilderState<string, boolean, string>>,
      readonly string[] | undefined
    >
  > = Record<
    string,
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
    string,
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

class ContractBuilder<
  CodecTypes extends Record<string, { output: unknown }> = Record<string, never>,
  Target extends string | undefined = undefined,
  Tables extends Record<
    string,
    TableBuilderState<
      string,
      Record<string, ColumnBuilderState<string, boolean, string>>,
      readonly string[] | undefined
    >
  > = Record<string, never>,
  Models extends Record<
    string,
    ModelBuilderState<string, string, Record<string, string>, Record<string, RelationDefinition>>
  > = Record<string, never>,
  CoreHash extends string | undefined = undefined,
  Extensions extends Record<string, unknown> | undefined = undefined,
  Capabilities extends Record<string, Record<string, boolean>> | undefined = undefined,
> {
  private readonly state: ContractBuilderState<
    Target,
    Tables,
    Models,
    CoreHash,
    Extensions,
    Capabilities
  >;

  constructor(
    state?: ContractBuilderState<Target, Tables, Models, CoreHash, Extensions, Capabilities>,
  ) {
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
      Record<string, ColumnBuilderState<string, boolean, string>>,
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
    M extends ModelBuilder<
      ModelName,
      TableName,
      Record<string, string>,
      Record<string, RelationDefinition>
    >,
  >(
    name: ModelName,
    table: TableName,
    callback: (
      m: ModelBuilder<ModelName, TableName, Record<string, string>, Record<string, never>>,
    ) => M | undefined,
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

  /**
   * Builds and normalizes the contract.
   *
   * **Responsibility: Normalization**
   * This method is responsible for normalizing the contract IR by setting default values
   * for all required fields:
   * - `nullable`: defaults to `false` if not provided
   * - `uniques`: defaults to `[]` (empty array)
   * - `indexes`: defaults to `[]` (empty array)
   * - `foreignKeys`: defaults to `[]` (empty array)
   * - `relations`: defaults to `{}` (empty object) for both model-level and contract-level
   *
   * The contract builder is the **only** place where normalization should occur.
   * Validators, parsers, and emitters should assume the contract is already normalized.
   *
   * @returns A normalized SqlContract with all required fields present
   */
  build(): Target extends string
    ? SqlContract<
        BuildStorage<Tables>,
        BuildModels<Models>,
        BuildRelations<Models>,
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
          BuildStorage<Tables>,
          BuildModels<Models>,
          BuildRelations<Models>,
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
    const storageTables: Partial<BuildStorage<Tables>['tables']> = {};

    // Iterate over tables - TypeScript will see keys as string, but type assertion preserves literals
    for (const tableName in this.state.tables) {
      const tableState = this.state.tables[tableName];
      if (!tableState) continue;

      const tableStateTyped = tableState as unknown as {
        name: string;
        columns: Record<string, ColumnBuilderState<string, boolean, string>>;
        primaryKey?: readonly string[] | { columns: readonly string[] };
      };

      // Build columns object
      const columns: Partial<Record<string, StorageColumn>> = {};

      // Iterate over columns
      for (const columnName in tableStateTyped.columns) {
        const columnState = tableStateTyped.columns[columnName];
        if (!columnState) continue;

        if (!columnState.type) {
          throw new Error(
            `Column "${columnName}" in table "${tableName}" is missing required type`,
          );
        }
        const column: StorageColumn = {
          type: columnState.type,
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
        uniques: [],
        indexes: [],
        foreignKeys: [],
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
      (modelsPartial as unknown as Record<string, ModelDefinition>)[modelName] = {
        storage: {
          table: modelStateTyped.table,
        },
        fields: fields as Record<string, ModelField>,
        relations: {},
      };
    }

    // Build relations object - organized by table name
    const relationsPartial: Partial<Record<string, Record<string, RelationDefinition>>> = {};

    // Iterate over models to collect relations
    for (const modelName in this.state.models) {
      const modelState = this.state.models[modelName];
      if (!modelState) continue;

      const modelStateTyped = modelState as unknown as {
        name: string;
        table: string;
        fields: Record<string, string>;
        relations: Record<string, RelationDefinition>;
      };

      const tableName = modelStateTyped.table;
      if (!tableName) continue;

      // Only initialize relations object for this table if it has relations
      if (modelStateTyped.relations && Object.keys(modelStateTyped.relations).length > 0) {
        if (!relationsPartial[tableName]) {
          relationsPartial[tableName] = {};
        }

        // Add relations from this model to the table's relations
        const tableRelations = relationsPartial[tableName];
        if (tableRelations) {
          for (const relationName in modelStateTyped.relations) {
            const relation = modelStateTyped.relations[relationName];
            if (relation) {
              tableRelations[relationName] = relation;
            }
          }
        }
      }
    }

    // Type assertions to preserve literal types from generics
    // The type system knows these match BuildStorage/BuildModels from the generics
    const storage = { tables: storageTables } as unknown as BuildStorage<Tables>;
    const models = modelsPartial as unknown as BuildModels<Models>;

    const mappings = computeMappings(
      models as unknown as Record<string, ModelDefinition>,
      storage as SqlStorage,
    );

    // Construct contract with explicit type that matches the generic parameters
    // This ensures TypeScript infers literal types from the generics, not runtime values
    // Always include relations, even if empty (normalized to empty object)
    const contract = {
      schemaVersion: '1' as const,
      target,
      targetFamily: 'sql' as const,
      coreHash: this.state.coreHash || 'sha256:ts-builder-placeholder',
      models,
      relations: relationsPartial,
      storage,
      mappings,
      extensions: this.state.extensions || {},
      capabilities: this.state.capabilities || {},
      meta: {},
      sources: {},
    } as unknown as BuiltContract;

    return contract as unknown as ReturnType<
      ContractBuilder<
        CodecTypes,
        Target,
        Tables,
        Models,
        CoreHash,
        Extensions,
        Capabilities
      >['build']
    >;
  }
}

export function defineContract<
  CodecTypes extends Record<string, { output: unknown }> = Record<string, never>,
>(): ContractBuilder<CodecTypes> {
  return new ContractBuilder<CodecTypes>();
}
