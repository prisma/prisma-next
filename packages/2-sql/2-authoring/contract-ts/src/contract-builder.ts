import type {
  ExtensionPackRef,
  FamilyPackRef,
  TargetPackRef,
} from '@prisma-next/contract/framework-components';
import type { ExecutionMutationDefaultValue } from '@prisma-next/contract/types';
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
  type ExtractPrimaryKey,
  ModelBuilder,
  TableBuilder,
} from '@prisma-next/contract-authoring';
import type {
  ContractWithTypeMaps,
  Index,
  SqlContract,
  SqlMappings,
  StorageTypeInstance,
  TypeMaps,
} from '@prisma-next/sql-contract/types';
import {
  type ComposedAuthoringHelpers,
  createComposedAuthoringHelpers,
} from './composed-authoring-helpers';
import {
  buildContractIR,
  buildSqlContractFromSemanticDefinition,
  type RuntimeBuilderState,
} from './contract-ir-builder';

export { buildSqlContractFromSemanticDefinition } from './contract-ir-builder';

import {
  field,
  isStagedContractInput,
  type ModelAttributesSpec,
  model,
  type RelationBuilder,
  rel,
  type ScalarFieldBuilder,
  type SqlStageSpec,
  type StagedContractInput,
  type StagedModelBuilder,
  type RelationState as StagedRelationState,
} from './staged-contract-dsl';
import { buildStagedSemanticContractDefinition } from './staged-contract-lowering';
import type {
  ExtractCodecTypesFromPack,
  MergeExtensionCodecTypes,
  MergeExtensionPackRefs,
  SqlContractResult,
} from './staged-contract-types';

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

export interface ColumnBuilder<Name extends string, Nullable extends boolean, Type extends string> {
  nullable<Value extends boolean>(value?: Value): ColumnBuilder<Name, Value, Type>;
  type<Id extends string>(id: Id): ColumnBuilder<Name, Nullable, Id>;
  build(): ColumnBuilderState<Name, Nullable, Type>;
}

type StagedModelLike = {
  readonly stageOne: {
    readonly modelName?: string;
    readonly fields: Record<string, ScalarFieldBuilder>;
    readonly relations: Record<string, RelationBuilder<StagedRelationState>>;
  };
  readonly __attributes: ModelAttributesSpec | undefined;
  readonly __sql: SqlStageSpec | undefined;
  buildAttributesSpec(): ModelAttributesSpec | undefined;
  buildSqlSpec(): SqlStageSpec | undefined;
};

function buildStagedContract<Definition extends StagedContractInput>(
  definition: Definition,
): SqlContractResult<Definition> {
  return buildSqlContractFromSemanticDefinition(
    buildStagedSemanticContractDefinition(definition),
  ) as SqlContractResult<Definition>;
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
    ? ContractWithTypeMaps<
        SqlContract<
          BuildStorage<Tables, Types>,
          BuildModels<Models>,
          BuildRelations<Models>,
          ContractBuilderMappings
        > & {
          readonly schemaVersion: '1';
          readonly target: Target;
          readonly targetFamily: 'sql';
          readonly storageHash: StorageHash extends string ? StorageHash : string;
        } & (ExtensionPacks extends Record<string, unknown>
            ? { readonly extensionPacks: ExtensionPacks }
            : Record<string, never>) &
          (Capabilities extends Record<string, Record<string, boolean>>
            ? { readonly capabilities: Capabilities }
            : Record<string, never>),
        TypeMaps<CodecTypes, Record<string, never>>
      >
    : never {
    return buildContractIR(this.state as unknown as RuntimeBuilderState) as unknown as ReturnType<
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

  override target<
    T extends string,
    TPack extends TargetPackRef<string, T> = TargetPackRef<string, T>,
  >(
    packRef: TPack & TargetPackRef<string, T>,
  ): SqlContractBuilder<
    ExtractCodecTypesFromPack<TPack> extends Record<string, never>
      ? CodecTypes
      : ExtractCodecTypesFromPack<TPack>,
    T,
    Tables,
    Models,
    Types,
    StorageHash,
    ExtensionPacks,
    Capabilities
  > {
    return new SqlContractBuilder<
      ExtractCodecTypesFromPack<TPack> extends Record<string, never>
        ? CodecTypes
        : ExtractCodecTypesFromPack<TPack>,
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
    }) as SqlContractBuilder<
      ExtractCodecTypesFromPack<TPack> extends Record<string, never>
        ? CodecTypes
        : ExtractCodecTypesFromPack<TPack>,
      T,
      Tables,
      Models,
      Types,
      StorageHash,
      ExtensionPacks,
      Capabilities
    >;
  }

  extensionPacks<const Packs extends Record<string, ExtensionPackRef<'sql', string>>>(
    packs: Packs,
  ): SqlContractBuilder<
    CodecTypes & MergeExtensionCodecTypes<Packs>,
    Target,
    Tables,
    Models,
    Types,
    StorageHash,
    MergeExtensionPackRefs<ExtensionPacks, Packs>,
    Capabilities
  > {
    if (!this.state.target) {
      throw new Error('extensionPacks() requires target() to be called first');
    }

    const namespaces = new Set(this.state.extensionNamespaces ?? []);
    const nextExtensionPacks = {
      ...(this.state.extensionPacks ?? {}),
    } as Record<string, unknown>;

    for (const [name, packRef] of Object.entries(packs) as Array<
      [keyof Packs & string, ExtensionPackRef<'sql', string>]
    >) {
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
      nextExtensionPacks[name] = packRef;
    }

    return new SqlContractBuilder<
      CodecTypes & MergeExtensionCodecTypes<Packs>,
      Target,
      Tables,
      Models,
      Types,
      StorageHash,
      MergeExtensionPackRefs<ExtensionPacks, Packs>,
      Capabilities
    >({
      ...this.state,
      extensionPacks: nextExtensionPacks as MergeExtensionPackRefs<ExtensionPacks, Packs>,
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
    // Double cast: createTable returns an unparameterized builder; we first narrow
    // to SqlTableBuilder with the caller's generic params, then to the public
    // TableBuilder facade that the callback expects.
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

type StagedContractDefinition<
  Family extends FamilyPackRef<string>,
  Target extends TargetPackRef<'sql', string>,
  Types extends Record<string, StorageTypeInstance>,
  Models extends Record<string, StagedModelLike>,
  ExtensionPacks extends Record<string, ExtensionPackRef<'sql', string>> | undefined,
  Capabilities extends Record<string, Record<string, boolean>> | undefined,
  Naming extends StagedContractInput['naming'] | undefined,
  StorageHash extends string | undefined,
  ForeignKeyDefaults extends ForeignKeyDefaultsState | undefined,
> = {
  readonly family: Family;
  readonly target: Target;
  readonly extensionPacks?: ExtensionPacks;
  readonly naming?: Naming;
  readonly storageHash?: StorageHash;
  readonly foreignKeyDefaults?: ForeignKeyDefaults;
  readonly capabilities?: Capabilities;
  readonly types?: Types;
  readonly models?: Models;
};

type StagedContractScaffold<
  Family extends FamilyPackRef<string>,
  Target extends TargetPackRef<'sql', string>,
  ExtensionPacks extends Record<string, ExtensionPackRef<'sql', string>> | undefined,
  Capabilities extends Record<string, Record<string, boolean>> | undefined,
  Naming extends StagedContractInput['naming'] | undefined,
  StorageHash extends string | undefined,
  ForeignKeyDefaults extends ForeignKeyDefaultsState | undefined,
> = {
  readonly family: Family;
  readonly target: Target;
  readonly extensionPacks?: ExtensionPacks;
  readonly naming?: Naming;
  readonly storageHash?: StorageHash;
  readonly foreignKeyDefaults?: ForeignKeyDefaults;
  readonly capabilities?: Capabilities;
};

type StagedContractFactory<
  Family extends FamilyPackRef<string>,
  Target extends TargetPackRef<'sql', string>,
  Types extends Record<string, StorageTypeInstance>,
  Models extends Record<string, StagedModelLike>,
  ExtensionPacks extends Record<string, ExtensionPackRef<'sql', string>> | undefined,
> = (helpers: ComposedAuthoringHelpers<Family, Target, ExtensionPacks>) => {
  readonly types?: Types;
  readonly models?: Models;
};

export function defineContract<
  CodecTypes extends Record<string, { output: unknown }> = Record<string, never>,
>(): SqlContractBuilder<CodecTypes>;
export function defineContract<
  const Family extends FamilyPackRef<string>,
  const Target extends TargetPackRef<'sql', string>,
  const Types extends Record<string, StorageTypeInstance> = Record<never, never>,
  const Models extends Record<string, StagedModelLike> = Record<never, never>,
  const ExtensionPacks extends
    | Record<string, ExtensionPackRef<'sql', string>>
    | undefined = undefined,
  const Capabilities extends Record<string, Record<string, boolean>> | undefined = undefined,
  const Naming extends StagedContractInput['naming'] | undefined = undefined,
  const StorageHash extends string | undefined = undefined,
  const ForeignKeyDefaults extends ForeignKeyDefaultsState | undefined = undefined,
>(
  definition: StagedContractDefinition<
    Family,
    Target,
    Types,
    Models,
    ExtensionPacks,
    Capabilities,
    Naming,
    StorageHash,
    ForeignKeyDefaults
  >,
): SqlContractResult<
  StagedContractDefinition<
    Family,
    Target,
    Types,
    Models,
    ExtensionPacks,
    Capabilities,
    Naming,
    StorageHash,
    ForeignKeyDefaults
  >
>;
export function defineContract<
  const Family extends FamilyPackRef<string>,
  const Target extends TargetPackRef<'sql', string>,
  const Types extends Record<string, StorageTypeInstance> = Record<never, never>,
  const Models extends Record<string, StagedModelLike> = Record<never, never>,
  const ExtensionPacks extends
    | Record<string, ExtensionPackRef<'sql', string>>
    | undefined = undefined,
  const Capabilities extends Record<string, Record<string, boolean>> | undefined = undefined,
  const Naming extends StagedContractInput['naming'] | undefined = undefined,
  const StorageHash extends string | undefined = undefined,
  const ForeignKeyDefaults extends ForeignKeyDefaultsState | undefined = undefined,
>(
  definition: StagedContractScaffold<
    Family,
    Target,
    ExtensionPacks,
    Capabilities,
    Naming,
    StorageHash,
    ForeignKeyDefaults
  >,
  factory: StagedContractFactory<Family, Target, Types, Models, ExtensionPacks>,
): SqlContractResult<
  StagedContractDefinition<
    Family,
    Target,
    Types,
    Models,
    ExtensionPacks,
    Capabilities,
    Naming,
    StorageHash,
    ForeignKeyDefaults
  >
>;
export function defineContract<
  CodecTypes extends Record<string, { output: unknown }> = Record<string, never>,
>(
  definition?: StagedContractInput,
  factory?: StagedContractFactory<
    FamilyPackRef<string>,
    TargetPackRef<'sql', string>,
    Record<string, StorageTypeInstance>,
    Record<string, StagedModelLike>,
    Record<string, ExtensionPackRef<'sql', string>> | undefined
  >,
): SqlContractBuilder<CodecTypes> | SqlContractResult<StagedContractInput> {
  if (definition && isStagedContractInput(definition)) {
    if (factory) {
      const builtDefinition = {
        ...definition,
        ...factory(
          createComposedAuthoringHelpers({
            family: definition.family,
            target: definition.target,
            extensionPacks: definition.extensionPacks,
          }),
        ),
      };
      return buildStagedContract(builtDefinition);
    }
    return buildStagedContract(definition);
  }
  return new SqlContractBuilder<CodecTypes>();
}

export { field, model, rel };
export type {
  ComposedAuthoringHelpers,
  StagedContractInput,
  StagedModelBuilder,
  ScalarFieldBuilder,
};
