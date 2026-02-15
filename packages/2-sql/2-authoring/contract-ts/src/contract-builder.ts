import type { ExtensionPackRef, TargetPackRef } from '@prisma-next/contract/framework-components';
import type {
  ColumnDefault,
  ColumnDefaultLiteralInputValue,
  ColumnDefaultLiteralValue,
  ExecutionMutationDefault,
  ExecutionMutationDefaultValue,
  TaggedRaw,
} from '@prisma-next/contract/types';
import type {
  ColumnBuilderState,
  ColumnTypeDescriptor,
  ContractBuilderState,
  ForeignKeyDefaultsState,
  ModelBuilderState,
  RelationDefinition,
  TableBuilderState,
} from '@prisma-next/contract-authoring';
import {
  type BuildModels,
  type BuildRelations,
  type BuildStorageColumn,
  ContractBuilder,
  createTable,
  type ExtractColumns,
  type ExtractModelFields,
  type ExtractPrimaryKey,
  ModelBuilder,
  type Mutable,
  TableBuilder,
} from '@prisma-next/contract-authoring';
import {
  applyFkDefaults,
  type Index,
  type ModelDefinition,
  type ModelField,
  type ReferentialAction,
  type SqlContract,
  type SqlMappings,
  type SqlStorage,
  type StorageTypeInstance,
} from '@prisma-next/sql-contract/types';
import { ifDefined } from '@prisma-next/utils/defined';
import { computeMappings } from './contract';

type ColumnDefaultForCodec<
  CodecTypes extends Record<string, { output: unknown }>,
  CodecId extends string,
> =
  | {
      readonly kind: 'literal';
      readonly value: CodecId extends keyof CodecTypes ? CodecTypes[CodecId]['output'] : unknown;
    }
  | { readonly kind: 'function'; readonly expression: string };

type SqlNullableColumnOptions<
  Descriptor extends ColumnTypeDescriptor,
  CodecTypes extends Record<string, { output: unknown }>,
> = {
  readonly type: Descriptor;
  readonly nullable: true;
  readonly typeParams?: Record<string, unknown>;
  readonly default?: ColumnDefaultForCodec<CodecTypes, Descriptor['codecId']>;
};

type SqlNonNullableColumnOptions<
  Descriptor extends ColumnTypeDescriptor,
  CodecTypes extends Record<string, { output: unknown }>,
> = {
  readonly type: Descriptor;
  readonly nullable?: false;
  readonly typeParams?: Record<string, unknown>;
  readonly default?: ColumnDefaultForCodec<CodecTypes, Descriptor['codecId']>;
};

type SqlGeneratedColumnOptions<
  Descriptor extends ColumnTypeDescriptor,
  CodecTypes extends Record<string, { output: unknown }>,
> = Omit<SqlNonNullableColumnOptions<Descriptor, CodecTypes>, 'default' | 'nullable'> & {
  readonly nullable?: false;
  readonly generated: ExecutionMutationDefaultValue;
};

type SqlColumnOptions<
  Descriptor extends ColumnTypeDescriptor,
  CodecTypes extends Record<string, { output: unknown }>,
> =
  | SqlNullableColumnOptions<Descriptor, CodecTypes>
  | SqlNonNullableColumnOptions<Descriptor, CodecTypes>;

export interface SqlTableBuilder<
  Name extends string,
  CodecTypes extends Record<string, { output: unknown }>,
  Columns extends Record<string, ColumnBuilderState<string, boolean, string>> = Record<
    never,
    ColumnBuilderState<string, boolean, string>
  >,
  PrimaryKey extends readonly string[] | undefined = undefined,
> extends Omit<TableBuilder<Name, Columns, PrimaryKey>, 'column' | 'generated'> {
  column<ColName extends string, Descriptor extends ColumnTypeDescriptor>(
    name: ColName,
    options: SqlNullableColumnOptions<Descriptor, CodecTypes>,
  ): TableBuilder<
    Name,
    Columns & Record<ColName, ColumnBuilderState<ColName, true, Descriptor['codecId']>>,
    PrimaryKey
  >;
  column<ColName extends string, Descriptor extends ColumnTypeDescriptor>(
    name: ColName,
    options: SqlNonNullableColumnOptions<Descriptor, CodecTypes>,
  ): TableBuilder<
    Name,
    Columns & Record<ColName, ColumnBuilderState<ColName, false, Descriptor['codecId']>>,
    PrimaryKey
  >;
  column<ColName extends string, Descriptor extends ColumnTypeDescriptor>(
    name: ColName,
    options: SqlColumnOptions<Descriptor, CodecTypes>,
  ): TableBuilder<
    Name,
    Columns & Record<ColName, ColumnBuilderState<ColName, boolean, Descriptor['codecId']>>,
    PrimaryKey
  >;
  generated<ColName extends string, Descriptor extends ColumnTypeDescriptor>(
    name: ColName,
    options: SqlGeneratedColumnOptions<Descriptor, CodecTypes>,
  ): TableBuilder<
    Name,
    Columns & Record<ColName, ColumnBuilderState<ColName, false, Descriptor['codecId']>>,
    PrimaryKey
  >;
}

type InvertRecord<T extends Record<string, string>> = {
  readonly [K in keyof T & string as T[K]]: K;
};

type ContractBuilderMappings = SqlMappings;

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
  readonly uniques: ReadonlyArray<{ readonly columns: readonly string[]; readonly name?: string }>;
  readonly indexes: ReadonlyArray<Index>;
  readonly foreignKeys: ReadonlyArray<{
    readonly columns: readonly string[];
    readonly references: { readonly table: string; readonly columns: readonly string[] };
    readonly name?: string;
    readonly onDelete?: ReferentialAction;
    readonly onUpdate?: ReferentialAction;
    readonly constraint: boolean;
    readonly index: boolean;
  }>;
} & (PK extends readonly string[]
  ? { readonly primaryKey: { readonly columns: PK; readonly name?: string } }
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
  Types extends Record<string, StorageTypeInstance>,
> = {
  readonly tables: {
    readonly [K in keyof Tables]: BuildStorageTable<
      K & string,
      ExtractColumns<Tables[K]>,
      ExtractPrimaryKey<Tables[K]>
    >;
  };
  readonly types: Types;
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

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function isJsonValue(value: unknown): value is ColumnDefaultLiteralValue {
  if (value === null) return true;
  const valueType = typeof value;
  if (valueType === 'string' || valueType === 'number' || valueType === 'boolean') return true;
  if (Array.isArray(value)) {
    return value.every((item) => isJsonValue(item));
  }
  if (isPlainObject(value)) {
    return Object.values(value).every((item) => isJsonValue(item));
  }
  return false;
}

function encodeDefaultLiteralValue(
  value: ColumnDefaultLiteralInputValue,
): ColumnDefaultLiteralValue {
  if (typeof value === 'bigint') {
    return { $type: 'bigint', value: value.toString() };
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (isJsonValue(value)) {
    if (isPlainObject(value) && '$type' in value) {
      return { $type: 'raw', value } satisfies TaggedRaw;
    }
    return value;
  }
  throw new Error(
    'Unsupported column default literal value: expected JSON-safe value, bigint, or Date.',
  );
}

function encodeColumnDefault(defaultInput: ColumnDefault): ColumnDefault {
  if (defaultInput.kind === 'function') {
    return { kind: 'function', expression: defaultInput.expression };
  }
  return { kind: 'literal', value: encodeDefaultLiteralValue(defaultInput.value) };
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
  Types extends Record<string, StorageTypeInstance> = Record<never, never>,
  StorageHash extends string | undefined = undefined,
  ExtensionPacks extends Record<string, unknown> | undefined = undefined,
  Capabilities extends Record<string, Record<string, boolean>> | undefined = undefined,
> extends ContractBuilder<Target, Tables, Models, StorageHash, ExtensionPacks, Capabilities> {
  protected declare readonly state: ContractBuilderState<
    Target,
    Tables,
    Models,
    StorageHash,
    ExtensionPacks,
    Capabilities
  > & {
    readonly storageTypes?: Types;
  };
  /**
   * This method is responsible for normalizing the contract IR by setting default values
   * for all required fields:
   * - `nullable`: defaults to `false` if not provided
   * - `uniques`: defaults to `[]` (empty array)
   * - `indexes`: defaults to `[]` (empty array)
   * - `foreignKeys`: defaults to `[]` (empty array)
   * - `relations`: defaults to `{}` (empty object) for both model-level and contract-level
   * - `nativeType`: required field set from column type descriptor when columns are defined
   *
   * The contract builder is the **only** place where normalization should occur.
   * Validators, parsers, and emitters should assume the contract is already normalized.
   *
   * **Required**: Use column type descriptors (e.g., `int4Column`, `textColumn`) when defining columns.
   * This ensures `nativeType` is set correctly at build time.
   *
   * @returns A normalized SqlContract with all required fields present
   */
  build(): Target extends string
    ? SqlContract<
        BuildStorage<Tables, Types>,
        BuildModels<Models>,
        BuildRelations<Models>,
        ContractBuilderMappings
      > & {
        readonly '__@prisma-next/sql-contract/codecTypes@__': CodecTypes;
        readonly '__@prisma-next/sql-contract/operationTypes@__': Record<string, never>;
        readonly schemaVersion: '1';
        readonly target: Target;
        readonly targetFamily: 'sql';
        readonly storageHash: StorageHash extends string ? StorageHash : string;
      } & (ExtensionPacks extends Record<string, unknown>
          ? { readonly extensionPacks: ExtensionPacks }
          : unknown) &
        (Capabilities extends Record<string, Record<string, boolean>>
          ? { readonly capabilities: Capabilities }
          : unknown)
    : never {
    type BuiltContract = Target extends string
      ? SqlContract<
          BuildStorage<Tables, Types>,
          BuildModels<Models>,
          BuildRelations<Models>,
          ContractBuilderMappings
        > & {
          readonly '__@prisma-next/sql-contract/codecTypes@__': CodecTypes;
          readonly '__@prisma-next/sql-contract/operationTypes@__': Record<string, never>;
          readonly schemaVersion: '1';
          readonly target: Target;
          readonly targetFamily: 'sql';
          readonly storageHash: StorageHash extends string ? StorageHash : string;
        } & (ExtensionPacks extends Record<string, unknown>
            ? { readonly extensionPacks: ExtensionPacks }
            : unknown) &
          (Capabilities extends Record<string, Record<string, boolean>>
            ? { readonly capabilities: Capabilities }
            : unknown)
      : never;
    if (!this.state.target) {
      throw new Error('target is required. Call .target() before .build()');
    }

    const target = this.state.target as Target & string;

    const storageTables = {} as Partial<Mutable<BuildStorageTables<Tables>>>;
    const executionDefaults: ExecutionMutationDefault[] = [];

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
        const nativeType = columnState.nativeType;
        const typeRef = columnState.typeRef;

        const encodedDefault =
          columnState.default !== undefined
            ? encodeColumnDefault(columnState.default as ColumnDefault)
            : undefined;

        columns[columnName as keyof ColumnDefs] = {
          nativeType,
          codecId,
          nullable: (columnState.nullable ?? false) as ColumnDefs[keyof ColumnDefs]['nullable'] &
            boolean,
          ...ifDefined('typeParams', columnState.typeParams),
          ...ifDefined('default', encodedDefault),
          ...ifDefined('typeRef', typeRef),
        } as BuildStorageColumn<
          ColumnDefs[keyof ColumnDefs]['nullable'] & boolean,
          ColumnDefs[keyof ColumnDefs]['type']
        >;

        if ('executionDefault' in columnState && columnState.executionDefault) {
          executionDefaults.push({
            ref: { table: tableName, column: columnName },
            onCreate: columnState.executionDefault,
          });
        }
      }

      // Build uniques from table state
      const uniques = (tableState.uniques ?? []).map((u) => ({
        columns: u.columns,
        ...(u.name ? { name: u.name } : {}),
      }));

      // Build indexes from table state
      const indexes = (tableState.indexes ?? []).map((i) => ({
        columns: i.columns,
        ...(i.name ? { name: i.name } : {}),
        ...(i.using ? { using: i.using } : {}),
        ...(i.config ? { config: i.config } : {}),
      }));

      // Build foreign keys from table state, materializing defaults
      const foreignKeys = (tableState.foreignKeys ?? []).map((fk) => ({
        columns: fk.columns,
        references: fk.references,
        ...applyFkDefaults(fk, this.state.foreignKeyDefaults),
        ...(fk.name ? { name: fk.name } : {}),
        ...(fk.onDelete !== undefined ? { onDelete: fk.onDelete } : {}),
        ...(fk.onUpdate !== undefined ? { onUpdate: fk.onUpdate } : {}),
      }));

      const table = {
        columns: columns as {
          [K in keyof ColumnDefs]: BuildStorageColumn<
            ColumnDefs[K]['nullable'] & boolean,
            ColumnDefs[K]['type']
          >;
        },
        uniques,
        indexes,
        foreignKeys,
        ...(tableState.primaryKey
          ? {
              primaryKey: {
                columns: tableState.primaryKey,
                ...(tableState.primaryKeyName ? { name: tableState.primaryKeyName } : {}),
              },
            }
          : {}),
      } as unknown as BuildStorageTable<TableKey & string, ColumnDefs, PrimaryKey>;

      (storageTables as Mutable<BuildStorageTables<Tables>>)[tableName] = table;
    }

    const storageTypes = (this.state.storageTypes ?? {}) as Types;
    const storage: BuildStorage<Tables, Types> = {
      tables: storageTables as BuildStorageTables<Tables>,
      types: storageTypes,
    };

    const execution =
      executionDefaults.length > 0
        ? {
            mutations: {
              defaults: executionDefaults.sort((a, b) => {
                const tableCompare = a.ref.table.localeCompare(b.ref.table);
                if (tableCompare !== 0) {
                  return tableCompare;
                }
                return a.ref.column.localeCompare(b.ref.column);
              }),
            },
          }
        : undefined;

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

    const mappings = baseMappings as ContractBuilderMappings;

    const extensionNamespaces = this.state.extensionNamespaces ?? [];
    const extensionPacks: Record<string, unknown> = { ...(this.state.extensionPacks || {}) };
    for (const namespace of extensionNamespaces) {
      if (!Object.hasOwn(extensionPacks, namespace)) {
        extensionPacks[namespace] = {};
      }
    }

    // Construct contract with explicit type that matches the generic parameters
    // This ensures TypeScript infers literal types from the generics, not runtime values
    // Always include relations, even if empty (normalized to empty object)
    const contract = {
      schemaVersion: '1' as const,
      target,
      targetFamily: 'sql' as const,
      storageHash: this.state.storageHash || 'sha256:ts-builder-placeholder',
      models,
      relations: relationsPartial,
      storage,
      mappings,
      ...(execution ? { execution } : {}),
      extensionPacks,
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
        Types,
        StorageHash,
        ExtensionPacks,
        Capabilities
      >['build']
    >;
  }

  override target<T extends string>(
    packRef: TargetPackRef<'sql', T>,
  ): SqlContractBuilder<
    CodecTypes,
    T,
    Tables,
    Models,
    Types,
    StorageHash,
    ExtensionPacks,
    Capabilities
  > {
    return new SqlContractBuilder<
      CodecTypes,
      T,
      Tables,
      Models,
      Types,
      StorageHash,
      ExtensionPacks,
      Capabilities
    >({
      ...this.state,
      target: packRef.targetId,
    });
  }

  extensionPacks(
    packs: Record<string, ExtensionPackRef<'sql', string>>,
  ): SqlContractBuilder<
    CodecTypes,
    Target,
    Tables,
    Models,
    Types,
    StorageHash,
    ExtensionPacks,
    Capabilities
  > {
    if (!this.state.target) {
      throw new Error('extensionPacks() requires target() to be called first');
    }

    const namespaces = new Set(this.state.extensionNamespaces ?? []);

    for (const packRef of Object.values(packs)) {
      if (!packRef) continue;

      if (packRef.kind !== 'extension') {
        throw new Error(
          `extensionPacks() only accepts extension pack refs. Received kind "${packRef.kind}".`,
        );
      }

      if (packRef.familyId !== 'sql') {
        throw new Error(
          `extension pack "${packRef.id}" targets family "${packRef.familyId}" but this builder targets "sql".`,
        );
      }

      if (packRef.targetId && packRef.targetId !== this.state.target) {
        throw new Error(
          `extension pack "${packRef.id}" targets "${packRef.targetId}" but builder target is "${this.state.target}".`,
        );
      }

      namespaces.add(packRef.id);
    }

    return new SqlContractBuilder<
      CodecTypes,
      Target,
      Tables,
      Models,
      Types,
      StorageHash,
      ExtensionPacks,
      Capabilities
    >({
      ...this.state,
      extensionNamespaces: [...namespaces],
    });
  }

  override capabilities<C extends Record<string, Record<string, boolean>>>(
    capabilities: C,
  ): SqlContractBuilder<CodecTypes, Target, Tables, Models, Types, StorageHash, ExtensionPacks, C> {
    return new SqlContractBuilder<
      CodecTypes,
      Target,
      Tables,
      Models,
      Types,
      StorageHash,
      ExtensionPacks,
      C
    >({
      ...this.state,
      capabilities,
    });
  }

  override storageHash<H extends string>(
    hash: H,
  ): SqlContractBuilder<
    CodecTypes,
    Target,
    Tables,
    Models,
    Types,
    H,
    ExtensionPacks,
    Capabilities
  > {
    return new SqlContractBuilder<
      CodecTypes,
      Target,
      Tables,
      Models,
      Types,
      H,
      ExtensionPacks,
      Capabilities
    >({
      ...this.state,
      storageHash: hash,
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
    Types,
    StorageHash,
    ExtensionPacks,
    Capabilities
  > {
    const tableBuilder = createTable(name);
    const result = callback(
      tableBuilder as unknown as SqlTableBuilder<
        TableName,
        CodecTypes
      > as unknown as TableBuilder<TableName>,
    );
    const finalBuilder = result instanceof TableBuilder ? result : tableBuilder;
    const tableState = finalBuilder.build();

    return new SqlContractBuilder<
      CodecTypes,
      Target,
      Tables & Record<TableName, ReturnType<T['build']>>,
      Models,
      Types,
      StorageHash,
      ExtensionPacks,
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
      m: ModelBuilder<ModelName, TableName, Record<never, never>, Record<never, never>>,
    ) => M | undefined,
  ): SqlContractBuilder<
    CodecTypes,
    Target,
    Tables,
    Models & Record<ModelName, ReturnType<M['build']>>,
    Types,
    StorageHash,
    ExtensionPacks,
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
      Types,
      StorageHash,
      ExtensionPacks,
      Capabilities
    >({
      ...this.state,
      models: { ...this.state.models, [name]: modelState } as Models &
        Record<ModelName, ReturnType<M['build']>>,
    });
  }

  override foreignKeyDefaults(
    config: ForeignKeyDefaultsState,
  ): SqlContractBuilder<
    CodecTypes,
    Target,
    Tables,
    Models,
    Types,
    StorageHash,
    ExtensionPacks,
    Capabilities
  > {
    return new SqlContractBuilder<
      CodecTypes,
      Target,
      Tables,
      Models,
      Types,
      StorageHash,
      ExtensionPacks,
      Capabilities
    >({
      ...this.state,
      foreignKeyDefaults: config,
    });
  }

  storageType<Name extends string, Type extends StorageTypeInstance>(
    name: Name,
    typeInstance: Type,
  ): SqlContractBuilder<
    CodecTypes,
    Target,
    Tables,
    Models,
    Types & Record<Name, Type>,
    StorageHash,
    ExtensionPacks,
    Capabilities
  > {
    return new SqlContractBuilder<
      CodecTypes,
      Target,
      Tables,
      Models,
      Types & Record<Name, Type>,
      StorageHash,
      ExtensionPacks,
      Capabilities
    >({
      ...this.state,
      storageTypes: {
        ...(this.state.storageTypes ?? {}),
        [name]: typeInstance,
      },
    });
  }
}

export function defineContract<
  CodecTypes extends Record<string, { output: unknown }> = Record<string, never>,
>(): SqlContractBuilder<CodecTypes> {
  return new SqlContractBuilder<CodecTypes>();
}
