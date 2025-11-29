import type {
  ColumnBuilderState,
  ModelBuilderState,
  RelationDefinition,
  TableBuilderState,
} from '@prisma-next/contract-authoring';
import {
  type BuildModels,
  type BuildRelations,
  type BuildStorageColumn,
  ContractBuilder,
  type ExtractColumns,
  type ExtractPrimaryKey,
  ModelBuilder,
  type Mutable,
  TableBuilder,
} from '@prisma-next/contract-authoring';
import type {
  ModelDefinition,
  ModelField,
  SqlContract,
  SqlMappings,
  SqlStorage,
} from '@prisma-next/sql-contract/types';
import { computeMappings } from './contract';

/**
 * Type-level mappings structure for contracts built via `defineContract()`.
 *
 * Compile-time type helper (not a runtime object) that ensures mappings match what the builder
 * produces. `codecTypes` uses the generic `CodecTypes` parameter; `operationTypes` is always
 * empty since operations are added via extensions at runtime.
 *
 * **Difference from RuntimeContext**: This is a compile-time type for contract construction.
 * `RuntimeContext` is a runtime object with populated registries for query execution.
 *
 * @template C - The `CodecTypes` generic parameter passed to `defineContract<CodecTypes>()`
 */
type ContractBuilderMappings<C extends Record<string, { output: unknown }>> = Omit<
  SqlMappings,
  'codecTypes' | 'operationTypes'
> & {
  readonly codecTypes: C;
  readonly operationTypes: Record<string, never>;
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

type BuildStorageTables<
  Tables extends Record<
    string,
    TableBuilderState<
      string,
      Record<string, ColumnBuilderState<string, boolean, string>>,
      readonly string[] | undefined
    >
  >,
> = {
  readonly [K in keyof Tables]: BuildStorageTable<
    K & string,
    ExtractColumns<Tables[K]>,
    ExtractPrimaryKey<Tables[K]>
  >;
};

export interface ColumnBuilder<Name extends string, Nullable extends boolean, Type extends string> {
  nullable<Value extends boolean>(value?: Value): ColumnBuilder<Name, Value, Type>;
  type<Id extends string>(id: Id): ColumnBuilder<Name, Nullable, Id>;
  build(): ColumnBuilderState<Name, Nullable, Type>;
}

class SqlContractBuilder<
  CodecTypes extends Record<string, { output: unknown }> = Record<string, never>,
  Target extends string | undefined = undefined,
  Tables extends Record<
    string,
    TableBuilderState<
      string,
      Record<string, ColumnBuilderState<string, boolean, string>>,
      readonly string[] | undefined
    >
  > = Record<never, never>,
  Models extends Record<
    string,
    ModelBuilderState<string, string, Record<string, string>, Record<string, RelationDefinition>>
  > = Record<never, never>,
  CoreHash extends string | undefined = undefined,
  Extensions extends Record<string, unknown> | undefined = undefined,
  Capabilities extends Record<string, Record<string, boolean>> | undefined = undefined,
> extends ContractBuilder<Target, Tables, Models, CoreHash, Extensions, Capabilities> {
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
   * - `nativeType`: looked up from type metadata registry using `codecId`
   *
   * The contract builder is the **only** place where normalization should occur.
   * Validators, parsers, and emitters should assume the contract is already normalized.
   *
   * @param options - Optional build options
   * @param options.getNativeType - Optional function to lookup nativeType from codecId.
   *   If not provided, nativeType must be set explicitly or will be handled at emission time.
   * @returns A normalized SqlContract with all required fields present
   */
  build(options?: {
    getNativeType?: (codecId: string) => string | undefined;
  }): Target extends string
    ? SqlContract<
        BuildStorage<Tables>,
        BuildModels<Models>,
        BuildRelations<Models>,
        ContractBuilderMappings<CodecTypes>
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
          ContractBuilderMappings<CodecTypes>
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

    const storageTables = {} as Partial<Mutable<BuildStorageTables<Tables>>>;

    for (const tableName of Object.keys(this.state.tables) as Array<keyof Tables & string>) {
      const tableState = this.state.tables[tableName];
      if (!tableState) continue;

      type TableKey = typeof tableName;
      type ColumnDefs = ExtractColumns<Tables[TableKey]>;
      type PrimaryKey = ExtractPrimaryKey<Tables[TableKey]>;

      const columns = {} as Partial<{
        [K in keyof ColumnDefs]: BuildStorageColumn<
          ColumnDefs[K]['nullable'] & boolean,
          ColumnDefs[K]['type']
        >;
      }>;

      for (const columnName in tableState.columns) {
        const columnState = tableState.columns[columnName];
        if (!columnState) continue;
        const codecId = columnState.type;
        // Lookup nativeType from registry if provided
        // If getNativeType is provided but returns undefined, that's an error
        // If getNativeType is not provided, nativeType will be resolved at emission time
        let nativeType: string;
        if (options?.getNativeType) {
          nativeType = options.getNativeType(codecId);
          if (!nativeType) {
            throw new Error(
              `Cannot determine nativeType for codecId "${codecId}" in column "${columnName}" of table "${tableName}". ` +
                'The type metadata registry has no nativeType mapping for this codecId.',
            );
          }
        } else {
          // If registry lookup not available, use codecId as temporary value
          // This will be resolved during emission when registry is available
          // Note: This is not ideal per the brief (prefers construction time), but allows builder to work
          nativeType = codecId; // Temporary - will be replaced during emission
        }
        columns[columnName as keyof ColumnDefs] = {
          nativeType,
          codecId,
          nullable: (columnState.nullable ?? false) as ColumnDefs[keyof ColumnDefs]['nullable'] &
            boolean,
        } as BuildStorageColumn<
          ColumnDefs[keyof ColumnDefs]['nullable'] & boolean,
          ColumnDefs[keyof ColumnDefs]['type']
        >;
      }

      const table = {
        columns: columns as {
          [K in keyof ColumnDefs]: BuildStorageColumn<
            ColumnDefs[K]['nullable'] & boolean,
            ColumnDefs[K]['type']
          >;
        },
        uniques: [],
        indexes: [],
        foreignKeys: [],
        ...(tableState.primaryKey
          ? {
              primaryKey: {
                columns: tableState.primaryKey,
              },
            }
          : {}),
      } as unknown as BuildStorageTable<TableKey & string, ColumnDefs, PrimaryKey>;

      (storageTables as Mutable<BuildStorageTables<Tables>>)[tableName] = table;
    }

    const storage = { tables: storageTables as BuildStorageTables<Tables> } as BuildStorage<Tables>;

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

    const models = modelsPartial as unknown as BuildModels<Models>;

    const baseMappings = computeMappings(
      models as unknown as Record<string, ModelDefinition>,
      storage as SqlStorage,
    );

    const mappings = {
      ...baseMappings,
      codecTypes: {} as CodecTypes,
      operationTypes: {} as Record<string, never>,
    } as ContractBuilderMappings<CodecTypes>;

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
      SqlContractBuilder<
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

  override target<T extends string>(
    target: T,
  ): SqlContractBuilder<CodecTypes, T, Tables, Models, CoreHash, Extensions, Capabilities> {
    return new SqlContractBuilder<
      CodecTypes,
      T,
      Tables,
      Models,
      CoreHash,
      Extensions,
      Capabilities
    >({
      ...this.state,
      target,
    });
  }

  override extensions<E extends Record<string, unknown>>(
    extensions: E,
  ): SqlContractBuilder<CodecTypes, Target, Tables, Models, CoreHash, E, Capabilities> {
    return new SqlContractBuilder<CodecTypes, Target, Tables, Models, CoreHash, E, Capabilities>({
      ...this.state,
      extensions,
    });
  }

  override capabilities<C extends Record<string, Record<string, boolean>>>(
    capabilities: C,
  ): SqlContractBuilder<CodecTypes, Target, Tables, Models, CoreHash, Extensions, C> {
    return new SqlContractBuilder<CodecTypes, Target, Tables, Models, CoreHash, Extensions, C>({
      ...this.state,
      capabilities,
    });
  }

  override coreHash<H extends string>(
    hash: H,
  ): SqlContractBuilder<CodecTypes, Target, Tables, Models, H, Extensions, Capabilities> {
    return new SqlContractBuilder<CodecTypes, Target, Tables, Models, H, Extensions, Capabilities>({
      ...this.state,
      coreHash: hash,
    });
  }

  override table<
    TableName extends string,
    T extends TableBuilder<
      TableName,
      Record<string, ColumnBuilderState<string, boolean, string>>,
      readonly string[] | undefined
    >,
  >(
    name: TableName,
    callback: (t: TableBuilder<TableName>) => T | undefined,
  ): SqlContractBuilder<
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

    return new SqlContractBuilder<
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

  override model<
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
      m: ModelBuilder<ModelName, TableName, Record<string, string>, Record<never, never>>,
    ) => M | undefined,
  ): SqlContractBuilder<
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

    return new SqlContractBuilder<
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
}

export function defineContract<
  CodecTypes extends Record<string, { output: unknown }> = Record<string, never>,
>(): SqlContractBuilder<CodecTypes> {
  return new SqlContractBuilder<CodecTypes>();
}
