import type { ExtensionPackRef, TargetPackRef } from '@prisma-next/contract/framework-components';
import type { ContractIR } from '@prisma-next/contract/ir';
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
  type ExtractPrimaryKey,
  ModelBuilder,
  type Mutable,
  TableBuilder,
} from '@prisma-next/contract-authoring';
import {
  applyFkDefaults,
  type ContractWithTypeMaps,
  type Index,
  type ModelDefinition,
  type ModelField,
  type ReferentialAction,
  type SqlContract,
  type SqlMappings,
  type SqlStorage,
  type StorageTypeInstance,
  type TypeMaps,
} from '@prisma-next/sql-contract/types';
import { validateStorageSemantics } from '@prisma-next/sql-contract/validators';
import { ifDefined } from '@prisma-next/utils/defined';
import {
  type ComposedAuthoringHelpers,
  createComposedAuthoringHelpers,
} from './composed-authoring-helpers';
import { computeMappings } from './contract';
import {
  buildSemanticSqlContract,
  type SqlSemanticContractBuilderLike,
  type SqlSemanticContractDefinition,
  type SqlSemanticFieldNode,
  type SqlSemanticForeignKeyNode,
  type SqlSemanticIndexNode,
  type SqlSemanticModelNode,
  type SqlSemanticPrimaryKeyNode,
  type SqlSemanticRelationNode,
  type SqlSemanticUniqueConstraintNode,
} from './semantic-contract';
import {
  type AttributeStageIdFieldNames,
  applyNaming,
  type FieldStateOf,
  field,
  type IdConstraint,
  isStagedContractInput,
  type ModelAttributesSpec,
  model,
  normalizeRelationFieldNames,
  type RelationBuilder,
  rel,
  resolveRelationModelName,
  type ScalarFieldBuilder,
  type SqlStageSpec,
  type StagedContractInput,
  type StagedModelBuilder,
  type RelationState as StagedRelationState,
  type UniqueConstraint,
} from './staged-contract-dsl';

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

function assertStorageSemantics(storage: SqlStorage): void {
  const semanticErrors = validateStorageSemantics(storage);
  if (semanticErrors.length > 0) {
    throw new Error(`Contract semantic validation failed: ${semanticErrors.join('; ')}`);
  }
}

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

type ExtractCodecTypesFromPack<P> = P extends { __codecTypes?: infer C }
  ? C extends Record<string, { output: unknown }>
    ? C
    : Record<string, never>
  : Record<string, never>;

type UnionToIntersection<U> = (U extends unknown ? (k: U) => void : never) extends (
  k: infer I,
) => void
  ? I
  : never;

type MergeExtensionCodecTypes<Packs extends Record<string, unknown>> = UnionToIntersection<
  {
    [K in keyof Packs]: ExtractCodecTypesFromPack<Packs[K]>;
  }[keyof Packs]
>;

type MergeExtensionCodecTypesSafe<Packs> =
  Packs extends Record<string, unknown>
    ? keyof Packs extends never
      ? Record<string, never>
      : MergeExtensionCodecTypes<Packs>
    : Record<string, never>;

type StagedDefinitionExtensionPacks<Definition> = Definition extends {
  readonly extensionPacks?: infer Packs extends Record<string, ExtensionPackRef<'sql', string>>;
}
  ? Packs
  : Record<never, never>;

type StagedDefinitionCapabilities<Definition> = Definition extends {
  readonly capabilities?: infer Capabilities extends Record<string, Record<string, boolean>>;
}
  ? Capabilities
  : undefined;

type StagedDefinitionTargetId<Definition> = Definition extends {
  readonly target: TargetPackRef<'sql', infer Target>;
}
  ? Target
  : never;

type StagedDefinitionStorageHash<Definition> = Definition extends {
  readonly storageHash?: infer StorageHash extends string;
}
  ? StorageHash
  : undefined;

type Present<T> = Exclude<T, undefined>;

type CodecTypesFromStagedDefinition<Definition> = ExtractCodecTypesFromPack<
  Definition extends { readonly target: infer Target } ? Target : never
> &
  MergeExtensionCodecTypesSafe<StagedDefinitionExtensionPacks<Definition>>;

type StagedDefinitionModels<Definition> = Definition extends {
  readonly models?: unknown;
}
  ? Present<Definition['models']> extends Record<string, unknown>
    ? Present<Definition['models']>
    : Record<never, never>
  : Record<never, never>;

type StagedDefinitionTypes<Definition> = Definition extends {
  readonly types?: unknown;
}
  ? Present<Definition['types']> extends Record<string, StorageTypeInstance>
    ? Present<Definition['types']>
    : Record<never, never>
  : Record<never, never>;

type StagedDefinitionTableNaming<Definition> = Definition extends {
  readonly naming?: { readonly tables?: infer Strategy extends string };
}
  ? Strategy
  : undefined;

type StagedDefinitionColumnNaming<Definition> = Definition extends {
  readonly naming?: { readonly columns?: infer Strategy extends string };
}
  ? Strategy
  : undefined;

type FirstChar<S extends string> = S extends `${infer First}${string}` ? First : '';

type CharKind<C extends string> = C extends ''
  ? 'end'
  : C extends Lowercase<C>
    ? C extends Uppercase<C>
      ? 'other'
      : 'lower'
    : 'upper';

type ShouldInsertSnakeUnderscore<
  PrevKind extends 'start' | 'lower' | 'upper' | 'other' | 'end',
  Current extends string,
  Next extends string,
> = CharKind<Current> extends 'upper'
  ? PrevKind extends 'start'
    ? false
    : PrevKind extends 'lower'
      ? true
      : CharKind<Next> extends 'lower'
        ? true
        : false
  : false;

type SnakeCaseInternal<
  S extends string,
  PrevKind extends 'start' | 'lower' | 'upper' | 'other' | 'end' = 'start',
> = S extends `${infer Current}${infer Rest}`
  ? `${ShouldInsertSnakeUnderscore<PrevKind, Current, FirstChar<Rest>> extends true
      ? '_'
      : ''}${Lowercase<Current>}${SnakeCaseInternal<Rest, CharKind<Current>>}`
  : '';

type SnakeCase<S extends string> = string extends S ? string : SnakeCaseInternal<S>;

type ApplyNamingType<Name extends string, Strategy extends string | undefined> = string extends Name
  ? string
  : Strategy extends 'snake_case'
    ? SnakeCase<Name>
    : Name;

type StagedModelNames<Definition> = keyof StagedDefinitionModels<Definition> & string;

type StagedModelFields<
  Definition,
  ModelName extends StagedModelNames<Definition>,
> = StagedDefinitionModels<Definition>[ModelName] extends {
  readonly stageOne: {
    readonly fields: Record<string, ScalarFieldBuilder>;
  };
}
  ? StagedDefinitionModels<Definition>[ModelName]['stageOne']['fields']
  : Record<never, never>;

type StagedModelFieldNames<
  Definition,
  ModelName extends StagedModelNames<Definition>,
> = keyof StagedModelFields<Definition, ModelName> & string;

type StagedModelFieldState<
  Definition,
  ModelName extends StagedModelNames<Definition>,
  FieldName extends StagedModelFieldNames<Definition, ModelName>,
> = FieldStateOf<StagedModelFields<Definition, ModelName>[FieldName]>;

type StagedModelSql<
  Definition,
  ModelName extends StagedModelNames<Definition>,
> = StagedDefinitionModels<Definition>[ModelName] extends {
  readonly __sql: infer SqlSpec;
}
  ? SqlSpec
  : undefined;

type StagedModelAttributes<
  Definition,
  ModelName extends StagedModelNames<Definition>,
> = StagedDefinitionModels<Definition>[ModelName] extends {
  readonly __attributes: infer AttributesSpec;
}
  ? AttributesSpec
  : undefined;

type Defined<T> = Present<T>;

type FieldDescriptorOf<FieldState> = Defined<
  FieldState extends { readonly descriptor?: infer Descriptor } ? Descriptor : never
>;

type FieldTypeRefOf<FieldState> = Defined<
  FieldState extends { readonly typeRef?: infer TypeRef } ? TypeRef : never
>;

type FieldNullableOf<FieldState> = FieldState extends {
  readonly nullable: infer Nullable extends boolean;
}
  ? Nullable
  : boolean;

type FieldColumnOverrideOf<FieldState> = Defined<
  FieldState extends { readonly columnName?: infer ColumnName } ? ColumnName : never
>;

type FieldInlineIdSpecOf<FieldState> = Defined<
  FieldState extends { readonly id?: infer IdSpec } ? IdSpec : never
>;

type DescriptorCodecId<Descriptor> = Descriptor extends {
  readonly codecId: infer CodecId extends string;
}
  ? CodecId
  : string;

type DescriptorNativeType<Descriptor> = Descriptor extends {
  readonly nativeType: infer NativeType extends string;
}
  ? NativeType
  : string;

type DescriptorTypeParams<Descriptor> = Descriptor extends {
  readonly typeParams: infer TypeParams extends Record<string, unknown>;
}
  ? TypeParams
  : undefined;

type DescriptorTypeRef<Descriptor> = Descriptor extends {
  readonly typeRef: infer TypeRef extends string;
}
  ? TypeRef
  : undefined;

type LookupNamedStorageTypeKeyByValue<Definition, TypeRef extends StorageTypeInstance> = {
  [TypeName in keyof StagedDefinitionTypes<Definition> & string]: [TypeRef] extends [
    StagedDefinitionTypes<Definition>[TypeName],
  ]
    ? [StagedDefinitionTypes<Definition>[TypeName]] extends [TypeRef]
      ? TypeName
      : never
    : never;
}[keyof StagedDefinitionTypes<Definition> & string];

type ResolveNamedStorageTypeKey<Definition, TypeRef> = TypeRef extends string
  ? TypeRef
  : TypeRef extends StorageTypeInstance
    ? [LookupNamedStorageTypeKeyByValue<Definition, TypeRef>] extends [never]
      ? string
      : LookupNamedStorageTypeKeyByValue<Definition, TypeRef>
    : never;

type ResolveNamedStorageType<Definition, TypeRef> =
  ResolveNamedStorageTypeKey<Definition, TypeRef> extends infer TypeName extends string
    ? TypeName extends keyof StagedDefinitionTypes<Definition>
      ? StagedDefinitionTypes<Definition>[TypeName]
      : StorageTypeInstance
    : StorageTypeInstance;

type ResolveFieldDescriptor<Definition, FieldState> = [FieldDescriptorOf<FieldState>] extends [
  never,
]
  ? ResolveNamedStorageType<Definition, FieldTypeRefOf<FieldState>>
  : FieldDescriptorOf<FieldState>;

type ResolveFieldColumnTypeRef<Definition, FieldState> = [FieldTypeRefOf<FieldState>] extends [
  never,
]
  ? DescriptorTypeRef<FieldDescriptorOf<FieldState>>
  : ResolveNamedStorageTypeKey<Definition, FieldTypeRefOf<FieldState>>;

type ResolveFieldColumnTypeParams<Definition, FieldState> = [
  ResolveFieldColumnTypeRef<Definition, FieldState>,
] extends [string]
  ? undefined
  : DescriptorTypeParams<FieldDescriptorOf<FieldState>>;

type StagedModelTableName<Definition, ModelName extends StagedModelNames<Definition>> = [
  Defined<
    StagedModelSql<Definition, ModelName> extends { readonly table?: infer TableName }
      ? TableName
      : never
  >,
] extends [never]
  ? ApplyNamingType<ModelName, StagedDefinitionTableNaming<Definition>>
  : Defined<
        StagedModelSql<Definition, ModelName> extends { readonly table?: infer TableName }
          ? TableName
          : never
      > extends infer ExplicitTableName extends string
    ? ExplicitTableName
    : ApplyNamingType<ModelName, StagedDefinitionTableNaming<Definition>>;

type StagedModelColumnName<
  Definition,
  ModelName extends StagedModelNames<Definition>,
  FieldName extends StagedModelFieldNames<Definition, ModelName>,
> = [FieldColumnOverrideOf<StagedModelFieldState<Definition, ModelName, FieldName>>] extends [never]
  ? ApplyNamingType<FieldName, StagedDefinitionColumnNaming<Definition>>
  : FieldColumnOverrideOf<
        StagedModelFieldState<Definition, ModelName, FieldName>
      > extends infer ExplicitColumnName extends string
    ? ExplicitColumnName
    : ApplyNamingType<FieldName, StagedDefinitionColumnNaming<Definition>>;

type StagedFieldNamesToColumnNames<
  Definition,
  ModelName extends StagedModelNames<Definition>,
  FieldNames extends readonly string[],
> = FieldNames extends readonly []
  ? readonly []
  : FieldNames extends readonly [
        infer First extends StagedModelFieldNames<Definition, ModelName>,
        ...infer Rest extends readonly string[],
      ]
    ? readonly [
        StagedModelColumnName<Definition, ModelName, First>,
        ...StagedFieldNamesToColumnNames<Definition, ModelName, Rest>,
      ]
    : readonly string[];

type StagedInlineIdFieldName<Definition, ModelName extends StagedModelNames<Definition>> = {
  [FieldName in StagedModelFieldNames<Definition, ModelName>]: [
    FieldInlineIdSpecOf<StagedModelFieldState<Definition, ModelName, FieldName>>,
  ] extends [never]
    ? never
    : FieldName;
}[StagedModelFieldNames<Definition, ModelName>];

type StagedInlineIdFieldNames<Definition, ModelName extends StagedModelNames<Definition>> = [
  StagedInlineIdFieldName<Definition, ModelName>,
] extends [never]
  ? undefined
  : readonly [StagedInlineIdFieldName<Definition, ModelName>];

type StagedInlineIdName<Definition, ModelName extends StagedModelNames<Definition>> = {
  [FieldName in StagedModelFieldNames<Definition, ModelName>]: FieldInlineIdSpecOf<
    StagedModelFieldState<Definition, ModelName, FieldName>
  > extends { readonly name?: infer Name extends string }
    ? Name
    : never;
}[StagedModelFieldNames<Definition, ModelName>];

type StagedAttributeIdFieldNames<
  Definition,
  ModelName extends StagedModelNames<Definition>,
> = AttributeStageIdFieldNames<StagedModelAttributes<Definition, ModelName>>;

type StagedAttributeIdName<Definition, ModelName extends StagedModelNames<Definition>> = Defined<
  StagedModelAttributes<Definition, ModelName> extends {
    readonly id?: { readonly name?: infer Name extends string };
  }
    ? Name
    : never
>;

type StagedModelIdFieldNames<Definition, ModelName extends StagedModelNames<Definition>> = [
  StagedAttributeIdFieldNames<Definition, ModelName>,
] extends [undefined]
  ? StagedInlineIdFieldNames<Definition, ModelName>
  : StagedAttributeIdFieldNames<Definition, ModelName>;

type StagedModelIdName<Definition, ModelName extends StagedModelNames<Definition>> = [
  StagedAttributeIdName<Definition, ModelName>,
] extends [never]
  ? Defined<StagedInlineIdName<Definition, ModelName>>
  : StagedAttributeIdName<Definition, ModelName>;

type StagedStorageColumn<
  CodecId extends string,
  Nullable extends boolean,
  NativeType extends string,
  TypeRef extends string | undefined = undefined,
  TypeParams extends Record<string, unknown> | undefined = undefined,
> = {
  readonly nativeType: NativeType;
  readonly codecId: CodecId;
  readonly nullable: Nullable;
  readonly default?: ColumnDefault;
} & (TypeRef extends string ? { readonly typeRef: TypeRef } : Record<string, never>) &
  (TypeParams extends Record<string, unknown>
    ? { readonly typeParams: TypeParams }
    : Record<string, never>);

type StagedModelStorageColumn<
  Definition,
  ModelName extends StagedModelNames<Definition>,
  FieldName extends string,
> = FieldName extends StagedModelFieldNames<Definition, ModelName>
  ? StagedStorageColumn<
      DescriptorCodecId<
        ResolveFieldDescriptor<Definition, StagedModelFieldState<Definition, ModelName, FieldName>>
      >,
      FieldNullableOf<StagedModelFieldState<Definition, ModelName, FieldName>>,
      DescriptorNativeType<
        ResolveFieldDescriptor<Definition, StagedModelFieldState<Definition, ModelName, FieldName>>
      >,
      ResolveFieldColumnTypeRef<
        Definition,
        StagedModelFieldState<Definition, ModelName, FieldName>
      >,
      ResolveFieldColumnTypeParams<
        Definition,
        StagedModelFieldState<Definition, ModelName, FieldName>
      >
    >
  : never;

type StagedBuiltModels<Definition> = {
  readonly [ModelName in StagedModelNames<Definition>]: {
    readonly storage: {
      readonly table: StagedModelTableName<Definition, ModelName>;
    };
    readonly fields: {
      readonly [FieldName in StagedModelFieldNames<Definition, ModelName>]: {
        readonly column: StagedModelColumnName<Definition, ModelName, FieldName>;
      };
    };
  };
};

type StagedBuiltModelFields<
  Definition,
  ModelName extends StagedModelNames<Definition>,
> = StagedBuiltModels<Definition>[ModelName]['fields'];

type StagedBuiltModelTableName<
  Definition,
  ModelName extends StagedModelNames<Definition>,
> = StagedBuiltModels<Definition>[ModelName]['storage']['table'];

type StagedBuiltStorageTableColumns<Definition, ModelName extends StagedModelNames<Definition>> = {
  readonly [FieldName in keyof StagedBuiltModelFields<Definition, ModelName> &
    string as StagedBuiltModelFields<
    Definition,
    ModelName
  >[FieldName]['column']]: StagedModelStorageColumn<Definition, ModelName, FieldName>;
};

type StagedBuiltStorageTables<Definition> = {
  readonly [ModelName in StagedModelNames<Definition> as StagedBuiltModelTableName<
    Definition,
    ModelName
  >]: {
    readonly columns: StagedBuiltStorageTableColumns<Definition, ModelName>;
    readonly uniques: ReadonlyArray<{
      readonly columns: readonly string[];
      readonly name?: string;
    }>;
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
  } & (StagedModelIdFieldNames<Definition, ModelName> extends readonly string[]
    ? {
        readonly primaryKey: {
          readonly columns: StagedFieldNamesToColumnNames<
            Definition,
            ModelName,
            StagedModelIdFieldNames<Definition, ModelName>
          >;
          readonly name?: StagedModelIdName<Definition, ModelName>;
        };
      }
    : Record<string, never>);
};

type StagedBuiltStorage<Definition> = {
  readonly tables: StagedBuiltStorageTables<Definition>;
  readonly types: StagedDefinitionTypes<Definition>;
};

type StagedBuiltMappings<Definition> = {
  readonly modelToTable: {
    readonly [ModelName in StagedModelNames<Definition>]: StagedBuiltModelTableName<
      Definition,
      ModelName
    >;
  };
  readonly tableToModel: {
    readonly [ModelName in StagedModelNames<Definition> as StagedBuiltModelTableName<
      Definition,
      ModelName
    >]: ModelName;
  };
  readonly fieldToColumn: {
    readonly [ModelName in StagedModelNames<Definition>]: {
      readonly [FieldName in StagedModelFieldNames<Definition, ModelName>]: StagedModelColumnName<
        Definition,
        ModelName,
        FieldName
      >;
    };
  };
  readonly columnToField: {
    readonly [ModelName in StagedModelNames<Definition> as StagedBuiltModelTableName<
      Definition,
      ModelName
    >]: {
      readonly [FieldName in StagedModelFieldNames<Definition, ModelName> as StagedModelColumnName<
        Definition,
        ModelName,
        FieldName
      >]: FieldName;
    };
  };
};

type BuiltStagedContract<Definition> = ContractWithTypeMaps<
  SqlContract<
    StagedBuiltStorage<Definition>,
    StagedBuiltModels<Definition>,
    Record<string, Record<string, RelationDefinition>>,
    StagedBuiltMappings<Definition>
  > & {
    readonly schemaVersion: '1';
    readonly target: StagedDefinitionTargetId<Definition>;
    readonly targetFamily: 'sql';
    readonly storageHash: StagedDefinitionStorageHash<Definition> extends string
      ? StagedDefinitionStorageHash<Definition>
      : string;
  } & {
    readonly extensionPacks: keyof StagedDefinitionExtensionPacks<Definition> extends never
      ? Record<string, never>
      : StagedDefinitionExtensionPacks<Definition>;
    readonly capabilities: StagedDefinitionCapabilities<Definition> extends Record<
      string,
      Record<string, boolean>
    >
      ? StagedDefinitionCapabilities<Definition>
      : Record<string, Record<string, boolean>>;
  },
  TypeMaps<CodecTypesFromStagedDefinition<Definition>, Record<string, never>>
>;

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

type RuntimeStagedModel = StagedModelBuilder<
  string | undefined,
  Record<string, ScalarFieldBuilder>,
  Record<string, RelationBuilder<StagedRelationState>>,
  ModelAttributesSpec | undefined,
  SqlStageSpec | undefined
>;

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

type RuntimeModelSpec = {
  readonly modelName: string;
  readonly tableName: string;
  readonly fieldBuilders: Record<string, ScalarFieldBuilder>;
  readonly fieldToColumn: Record<string, string>;
  readonly relations: Record<string, RelationBuilder<StagedRelationState>>;
  readonly attributesSpec: ModelAttributesSpec | undefined;
  readonly sqlSpec: SqlStageSpec | undefined;
};

function resolveFieldDescriptor(
  modelName: string,
  fieldName: string,
  fieldState: FieldStateOf<ScalarFieldBuilder>,
  storageTypes: Record<string, StorageTypeInstance>,
): ColumnTypeDescriptor {
  if ('descriptor' in fieldState && fieldState.descriptor) {
    return fieldState.descriptor;
  }

  if ('typeRef' in fieldState && fieldState.typeRef) {
    const typeRef =
      typeof fieldState.typeRef === 'string'
        ? fieldState.typeRef
        : Object.entries(storageTypes).find(
            ([, storageType]) => storageType === fieldState.typeRef,
          )?.[0];

    if (!typeRef) {
      throw new Error(
        `Field "${modelName}.${fieldName}" references a storage type instance that is not present in definition.types`,
      );
    }

    const referencedType = storageTypes[typeRef];
    if (!referencedType) {
      throw new Error(
        `Field "${modelName}.${fieldName}" references unknown storage type "${typeRef}"`,
      );
    }

    return {
      codecId: referencedType.codecId,
      nativeType: referencedType.nativeType,
      typeRef,
    };
  }

  throw new Error(`Field "${modelName}.${fieldName}" does not resolve to a storage descriptor`);
}

function emitTypedNamedTypeFallbackWarnings(
  models: Record<string, RuntimeStagedModel>,
  storageTypes: Record<string, StorageTypeInstance>,
): void {
  const warnedFields = new Set<string>();

  for (const [modelName, modelDefinition] of Object.entries(models)) {
    for (const [fieldName, fieldBuilder] of Object.entries(modelDefinition.stageOne.fields)) {
      const fieldState = fieldBuilder.build();
      if (typeof fieldState.typeRef !== 'string' || !(fieldState.typeRef in storageTypes)) {
        continue;
      }

      const warningKey = `${modelName}.${fieldName}`;
      if (warnedFields.has(warningKey)) {
        continue;
      }
      warnedFields.add(warningKey);

      process.emitWarning(
        `Staged contract field "${modelName}.${fieldName}" uses field.namedType('${fieldState.typeRef}'). ` +
          `Use field.namedType(types.${fieldState.typeRef}) when the storage type is declared in the same contract to keep autocomplete and typed local refs.`,
        {
          code: 'PN_CONTRACT_TYPED_FALLBACK_AVAILABLE',
        },
      );
    }
  }
}

function hasNamedModelToken(
  models: Record<string, RuntimeStagedModel>,
  modelName: string,
): boolean {
  return models[modelName]?.stageOne.modelName === modelName;
}

function formatFieldSelection(fieldNames: readonly string[]): string {
  if (fieldNames.length === 1) {
    return `'${fieldNames[0]}'`;
  }

  return `[${fieldNames.map((fieldName) => `'${fieldName}'`).join(', ')}]`;
}

function formatTokenFieldSelection(modelName: string, fieldNames: readonly string[]): string {
  if (fieldNames.length === 1) {
    return `${modelName}.refs.${fieldNames[0]}`;
  }

  return `[${fieldNames.map((fieldName) => `${modelName}.refs.${fieldName}`).join(', ')}]`;
}

function formatConstraintsRefCall(modelName: string, fieldNames: readonly string[]): string {
  if (fieldNames.length === 1) {
    return `constraints.ref('${modelName}', '${fieldNames[0]}')`;
  }

  return `[${fieldNames
    .map((fieldName) => `constraints.ref('${modelName}', '${fieldName}')`)
    .join(', ')}]`;
}

function formatRelationModelDisplay(
  relationModel:
    | StagedRelationState['toModel']
    | Extract<StagedRelationState, { kind: 'manyToMany' }>['through'],
): string {
  if (relationModel.kind === 'lazyRelationModelName') {
    return `() => ${relationModel.resolve()}`;
  }

  return relationModel.source === 'string'
    ? `'${relationModel.modelName}'`
    : relationModel.modelName;
}

function formatBelongsToFallbackCall(
  targetModelDisplay: string,
  fromFields: readonly string[],
  toFields: readonly string[],
): string {
  return `rel.belongsTo(${targetModelDisplay}, { from: ${formatFieldSelection(fromFields)}, to: ${formatFieldSelection(toFields)} })`;
}

function formatHasManyFallbackCall(
  helperName: 'hasMany' | 'hasOne',
  targetModelDisplay: string,
  byFields: readonly string[],
): string {
  return `rel.${helperName}(${targetModelDisplay}, { by: ${formatFieldSelection(byFields)} })`;
}

function formatManyToManyFallbackCall(
  targetModelDisplay: string,
  throughModelDisplay: string,
  fromFields: readonly string[],
  toFields: readonly string[],
): string {
  return `rel.manyToMany(${targetModelDisplay}, { through: ${throughModelDisplay}, from: ${formatFieldSelection(fromFields)}, to: ${formatFieldSelection(toFields)} })`;
}

function emitTypedCrossModelFallbackWarnings(
  modelSpecs: ReadonlyMap<string, RuntimeModelSpec>,
  models: Record<string, RuntimeStagedModel>,
): void {
  const warnedKeys = new Set<string>();

  for (const spec of modelSpecs.values()) {
    for (const [relationName, relationBuilder] of Object.entries(spec.relations)) {
      const relation = relationBuilder.build();

      if (
        relation.toModel.kind === 'relationModelName' &&
        relation.toModel.source === 'string' &&
        hasNamedModelToken(models, relation.toModel.modelName)
      ) {
        const warningKey = `${spec.modelName}.${relationName}.toModel`;
        if (!warnedKeys.has(warningKey)) {
          warnedKeys.add(warningKey);

          const relationCall =
            relation.kind === 'belongsTo'
              ? formatBelongsToFallbackCall(
                  `'${relation.toModel.modelName}'`,
                  normalizeRelationFieldNames(relation.from),
                  normalizeRelationFieldNames(relation.to),
                )
              : relation.kind === 'hasMany'
                ? formatHasManyFallbackCall(
                    'hasMany',
                    `'${relation.toModel.modelName}'`,
                    normalizeRelationFieldNames(relation.by),
                  )
                : relation.kind === 'hasOne'
                  ? formatHasManyFallbackCall(
                      'hasOne',
                      `'${relation.toModel.modelName}'`,
                      normalizeRelationFieldNames(relation.by),
                    )
                  : formatManyToManyFallbackCall(
                      `'${relation.toModel.modelName}'`,
                      formatRelationModelDisplay(relation.through),
                      normalizeRelationFieldNames(relation.from),
                      normalizeRelationFieldNames(relation.to),
                    );

          const suggestion =
            relation.kind === 'belongsTo'
              ? formatBelongsToFallbackCall(
                  relation.toModel.modelName,
                  normalizeRelationFieldNames(relation.from),
                  normalizeRelationFieldNames(relation.to),
                )
              : relation.kind === 'hasMany'
                ? formatHasManyFallbackCall(
                    'hasMany',
                    relation.toModel.modelName,
                    normalizeRelationFieldNames(relation.by),
                  )
                : relation.kind === 'hasOne'
                  ? formatHasManyFallbackCall(
                      'hasOne',
                      relation.toModel.modelName,
                      normalizeRelationFieldNames(relation.by),
                    )
                  : formatManyToManyFallbackCall(
                      relation.toModel.modelName,
                      formatRelationModelDisplay(relation.through),
                      normalizeRelationFieldNames(relation.from),
                      normalizeRelationFieldNames(relation.to),
                    );

          process.emitWarning(
            `Staged contract relation "${spec.modelName}.${relationName}" uses ${relationCall}. ` +
              `Use ${suggestion} when the named model token is available in the same contract to keep typed relation targets and model refs.`,
            {
              code: 'PN_CONTRACT_TYPED_FALLBACK_AVAILABLE',
            },
          );
        }
      }

      if (
        relation.kind === 'manyToMany' &&
        relation.through.kind === 'relationModelName' &&
        relation.through.source === 'string' &&
        hasNamedModelToken(models, relation.through.modelName)
      ) {
        const warningKey = `${spec.modelName}.${relationName}.through`;
        if (!warnedKeys.has(warningKey)) {
          warnedKeys.add(warningKey);

          const relationCall = formatManyToManyFallbackCall(
            formatRelationModelDisplay(relation.toModel),
            `'${relation.through.modelName}'`,
            normalizeRelationFieldNames(relation.from),
            normalizeRelationFieldNames(relation.to),
          );
          const suggestion = formatManyToManyFallbackCall(
            formatRelationModelDisplay(relation.toModel),
            relation.through.modelName,
            normalizeRelationFieldNames(relation.from),
            normalizeRelationFieldNames(relation.to),
          );

          process.emitWarning(
            `Staged contract relation "${spec.modelName}.${relationName}" uses ${relationCall}. ` +
              `Use ${suggestion} when the named model token is available in the same contract to keep typed relation targets and model refs.`,
            {
              code: 'PN_CONTRACT_TYPED_FALLBACK_AVAILABLE',
            },
          );
        }
      }
    }

    for (const [foreignKeyIndex, foreignKey] of (spec.sqlSpec?.foreignKeys ?? []).entries()) {
      if (
        foreignKey.targetSource !== 'string' ||
        !hasNamedModelToken(models, foreignKey.targetModel)
      ) {
        continue;
      }

      const warningKey = `${spec.modelName}.sql.foreignKeys.${foreignKeyIndex}`;
      if (warnedKeys.has(warningKey)) {
        continue;
      }
      warnedKeys.add(warningKey);

      process.emitWarning(
        `Staged contract model "${spec.modelName}" uses ${formatConstraintsRefCall(foreignKey.targetModel, foreignKey.targetFields)} in .sql(...). ` +
          `Use ${formatTokenFieldSelection(foreignKey.targetModel, foreignKey.targetFields)} when the named model token is available in the same contract to keep typed model refs.`,
        {
          code: 'PN_CONTRACT_TYPED_FALLBACK_AVAILABLE',
        },
      );
    }
  }
}

function mapFieldNamesToColumnNames(
  modelName: string,
  fieldNames: readonly string[],
  fieldToColumn: Record<string, string>,
): readonly string[] {
  return fieldNames.map((fieldName) => {
    const columnName = fieldToColumn[fieldName];
    if (!columnName) {
      throw new Error(`Unknown field "${modelName}.${fieldName}" in staged contract definition`);
    }
    return columnName;
  });
}

function resolveInlineIdConstraint(spec: RuntimeModelSpec): IdConstraint | undefined {
  const inlineIdFields: string[] = [];
  let idName: string | undefined;

  for (const [fieldName, fieldBuilder] of Object.entries(spec.fieldBuilders)) {
    const fieldState = fieldBuilder.build();
    if (!fieldState.id) {
      continue;
    }

    inlineIdFields.push(fieldName);
    if (fieldState.id.name) {
      idName = fieldState.id.name;
    }
  }

  if (inlineIdFields.length === 0) {
    return undefined;
  }

  if (inlineIdFields.length > 1) {
    throw new Error(
      `Model "${spec.modelName}" marks multiple fields with .id(). Use .attributes(...) for compound identities.`,
    );
  }

  return {
    kind: 'id',
    fields: [inlineIdFields[0]],
    ...(idName ? { name: idName } : {}),
  };
}

function collectInlineUniqueConstraints(spec: RuntimeModelSpec): readonly UniqueConstraint[] {
  const constraints: UniqueConstraint[] = [];

  for (const [fieldName, fieldBuilder] of Object.entries(spec.fieldBuilders)) {
    const fieldState = fieldBuilder.build();
    if (!fieldState.unique) {
      continue;
    }

    constraints.push({
      kind: 'unique',
      fields: [fieldName],
      ...(fieldState.unique.name ? { name: fieldState.unique.name } : {}),
    });
  }

  return constraints;
}

function resolveModelIdConstraint(spec: RuntimeModelSpec): IdConstraint | undefined {
  const inlineId = resolveInlineIdConstraint(spec);
  const attributeId = spec.attributesSpec?.id;

  if (inlineId && attributeId) {
    throw new Error(
      `Model "${spec.modelName}" defines identity both inline and in .attributes(...). Pick one identity style.`,
    );
  }

  const resolvedId = attributeId ?? inlineId;
  if (resolvedId && resolvedId.fields.length === 0) {
    throw new Error(`Model "${spec.modelName}" defines an empty identity. Add at least one field.`);
  }

  return resolvedId;
}

function resolveModelUniqueConstraints(spec: RuntimeModelSpec): readonly UniqueConstraint[] {
  const attributeUniques = spec.attributesSpec?.uniques ?? [];
  for (const unique of attributeUniques) {
    if (unique.fields.length === 0) {
      throw new Error(
        `Model "${spec.modelName}" defines an empty unique constraint. Add at least one field.`,
      );
    }
  }

  return [...collectInlineUniqueConstraints(spec), ...attributeUniques];
}

function resolveRelationForeignKeys(
  spec: RuntimeModelSpec,
  allSpecs: ReadonlyMap<string, RuntimeModelSpec>,
): readonly ForeignKeyConstraint[] {
  const foreignKeys: ForeignKeyConstraint[] = [];

  for (const [relationName, relationBuilder] of Object.entries(spec.relations)) {
    const relation = relationBuilder.build();
    if (relation.kind !== 'belongsTo' || !relation.sql?.fk) {
      continue;
    }

    const targetModelName = resolveRelationModelName(relation.toModel);
    if (!allSpecs.has(targetModelName)) {
      throw new Error(
        `Relation "${spec.modelName}.${relationName}" references unknown model "${targetModelName}"`,
      );
    }

    foreignKeys.push({
      kind: 'fk',
      fields: normalizeRelationFieldNames(relation.from),
      targetModel: targetModelName,
      targetFields: normalizeRelationFieldNames(relation.to),
      ...(relation.sql.fk.name ? { name: relation.sql.fk.name } : {}),
      ...(relation.sql.fk.onDelete ? { onDelete: relation.sql.fk.onDelete } : {}),
      ...(relation.sql.fk.onUpdate ? { onUpdate: relation.sql.fk.onUpdate } : {}),
      ...(relation.sql.fk.constraint !== undefined
        ? { constraint: relation.sql.fk.constraint }
        : {}),
      ...(relation.sql.fk.index !== undefined ? { index: relation.sql.fk.index } : {}),
    });
  }

  return foreignKeys;
}

function resolveRelationAnchorFields(spec: RuntimeModelSpec): readonly string[] {
  const idFields = resolveModelIdConstraint(spec)?.fields;
  if (idFields && idFields.length > 0) {
    return idFields;
  }

  if ('id' in spec.fieldToColumn) {
    return ['id'];
  }

  throw new Error(
    `Model "${spec.modelName}" needs an explicit id or an "id" field to anchor non-owning relations`,
  );
}

function resolveSemanticRelationNode(
  relationName: string,
  relation: StagedRelationState,
  currentSpec: RuntimeModelSpec,
  allSpecs: Map<string, RuntimeModelSpec>,
): SqlSemanticRelationNode {
  const targetModelName = resolveRelationModelName(relation.toModel);
  const targetSpec = allSpecs.get(targetModelName);
  if (!targetSpec) {
    throw new Error(
      `Relation "${currentSpec.modelName}.${relationName}" references unknown model "${targetModelName}"`,
    );
  }

  if (relation.kind === 'belongsTo') {
    const fromFields = normalizeRelationFieldNames(relation.from);
    const toFields = normalizeRelationFieldNames(relation.to);

    return {
      fieldName: relationName,
      toModel: targetModelName,
      toTable: targetSpec.tableName,
      cardinality: 'N:1',
      on: {
        parentTable: currentSpec.tableName,
        parentColumns: mapFieldNamesToColumnNames(
          currentSpec.modelName,
          fromFields,
          currentSpec.fieldToColumn,
        ),
        childTable: targetSpec.tableName,
        childColumns: mapFieldNamesToColumnNames(
          targetSpec.modelName,
          toFields,
          targetSpec.fieldToColumn,
        ),
      },
    };
  }

  if (relation.kind === 'hasMany' || relation.kind === 'hasOne') {
    const parentFields = resolveRelationAnchorFields(currentSpec);
    const childFields = normalizeRelationFieldNames(relation.by);

    return {
      fieldName: relationName,
      toModel: targetModelName,
      toTable: targetSpec.tableName,
      cardinality: relation.kind === 'hasMany' ? '1:N' : '1:1',
      on: {
        parentTable: currentSpec.tableName,
        parentColumns: mapFieldNamesToColumnNames(
          currentSpec.modelName,
          parentFields,
          currentSpec.fieldToColumn,
        ),
        childTable: targetSpec.tableName,
        childColumns: mapFieldNamesToColumnNames(
          targetSpec.modelName,
          childFields,
          targetSpec.fieldToColumn,
        ),
      },
    };
  }

  const throughModelName = resolveRelationModelName(relation.through);
  const throughSpec = allSpecs.get(throughModelName);
  if (!throughSpec) {
    throw new Error(
      `Relation "${currentSpec.modelName}.${relationName}" references unknown through model "${throughModelName}"`,
    );
  }

  const currentAnchorFields = resolveRelationAnchorFields(currentSpec);
  const throughFromFields = normalizeRelationFieldNames(relation.from);
  const throughToFields = normalizeRelationFieldNames(relation.to);

  return {
    fieldName: relationName,
    toModel: targetModelName,
    toTable: targetSpec.tableName,
    cardinality: 'N:M',
    through: {
      table: throughSpec.tableName,
      parentColumns: mapFieldNamesToColumnNames(
        throughSpec.modelName,
        throughFromFields,
        throughSpec.fieldToColumn,
      ),
      childColumns: mapFieldNamesToColumnNames(
        throughSpec.modelName,
        throughToFields,
        throughSpec.fieldToColumn,
      ),
    },
    on: {
      parentTable: currentSpec.tableName,
      parentColumns: mapFieldNamesToColumnNames(
        currentSpec.modelName,
        currentAnchorFields,
        currentSpec.fieldToColumn,
      ),
      childTable: throughSpec.tableName,
      childColumns: mapFieldNamesToColumnNames(
        throughSpec.modelName,
        throughFromFields,
        throughSpec.fieldToColumn,
      ),
    },
  };
}

function resolveSemanticForeignKeyNodes(
  spec: RuntimeModelSpec,
  allSpecs: ReadonlyMap<string, RuntimeModelSpec>,
): readonly SqlSemanticForeignKeyNode[] {
  const relationForeignKeys = resolveRelationForeignKeys(spec, allSpecs).map((foreignKey) => {
    const targetSpec = allSpecs.get(foreignKey.targetModel);
    if (!targetSpec) {
      throw new Error(
        `Foreign key on "${spec.modelName}" references unknown model "${foreignKey.targetModel}"`,
      );
    }

    return {
      columns: mapFieldNamesToColumnNames(spec.modelName, foreignKey.fields, spec.fieldToColumn),
      references: {
        model: targetSpec.modelName,
        table: targetSpec.tableName,
        columns: mapFieldNamesToColumnNames(
          targetSpec.modelName,
          foreignKey.targetFields,
          targetSpec.fieldToColumn,
        ),
      },
      ...(foreignKey.name ? { name: foreignKey.name } : {}),
      ...(foreignKey.onDelete ? { onDelete: foreignKey.onDelete } : {}),
      ...(foreignKey.onUpdate ? { onUpdate: foreignKey.onUpdate } : {}),
      ...(foreignKey.constraint !== undefined ? { constraint: foreignKey.constraint } : {}),
      ...(foreignKey.index !== undefined ? { index: foreignKey.index } : {}),
    } satisfies SqlSemanticForeignKeyNode;
  });

  const sqlForeignKeys = (spec.sqlSpec?.foreignKeys ?? []).map((foreignKey) => {
    const targetSpec = allSpecs.get(foreignKey.targetModel);
    if (!targetSpec) {
      throw new Error(
        `Foreign key on "${spec.modelName}" references unknown model "${foreignKey.targetModel}"`,
      );
    }

    return {
      columns: mapFieldNamesToColumnNames(spec.modelName, foreignKey.fields, spec.fieldToColumn),
      references: {
        model: targetSpec.modelName,
        table: targetSpec.tableName,
        columns: mapFieldNamesToColumnNames(
          targetSpec.modelName,
          foreignKey.targetFields,
          targetSpec.fieldToColumn,
        ),
      },
      ...(foreignKey.name ? { name: foreignKey.name } : {}),
      ...(foreignKey.onDelete ? { onDelete: foreignKey.onDelete } : {}),
      ...(foreignKey.onUpdate ? { onUpdate: foreignKey.onUpdate } : {}),
      ...(foreignKey.constraint !== undefined ? { constraint: foreignKey.constraint } : {}),
      ...(foreignKey.index !== undefined ? { index: foreignKey.index } : {}),
    } satisfies SqlSemanticForeignKeyNode;
  });

  return [...relationForeignKeys, ...sqlForeignKeys];
}

function resolveSemanticModelNode(
  spec: RuntimeModelSpec,
  allSpecs: ReadonlyMap<string, RuntimeModelSpec>,
  storageTypes: Record<string, StorageTypeInstance>,
): SqlSemanticModelNode {
  const fields: SqlSemanticFieldNode[] = [];

  for (const [fieldName, fieldBuilder] of Object.entries(spec.fieldBuilders)) {
    const fieldState = fieldBuilder.build();
    const descriptor = resolveFieldDescriptor(spec.modelName, fieldName, fieldState, storageTypes);
    const columnName = spec.fieldToColumn[fieldName];
    if (!columnName) {
      throw new Error(`Column name resolution failed for "${spec.modelName}.${fieldName}"`);
    }

    fields.push({
      fieldName,
      columnName,
      descriptor,
      nullable: fieldState.nullable,
      ...(fieldState.default ? { default: fieldState.default } : {}),
      ...(fieldState.executionDefault ? { executionDefault: fieldState.executionDefault } : {}),
    });
  }

  const idConstraint = resolveModelIdConstraint(spec);
  const uniques = resolveModelUniqueConstraints(spec).map((unique) => ({
    columns: mapFieldNamesToColumnNames(spec.modelName, unique.fields, spec.fieldToColumn),
    ...(unique.name ? { name: unique.name } : {}),
  })) satisfies readonly SqlSemanticUniqueConstraintNode[];
  const indexes = (spec.sqlSpec?.indexes ?? []).map((index) => ({
    columns: mapFieldNamesToColumnNames(spec.modelName, index.fields, spec.fieldToColumn),
    ...(index.name ? { name: index.name } : {}),
    ...(index.using ? { using: index.using } : {}),
    ...(index.config ? { config: index.config } : {}),
  })) satisfies readonly SqlSemanticIndexNode[];
  const foreignKeys = resolveSemanticForeignKeyNodes(spec, allSpecs);
  const relations = Object.entries(spec.relations).map(([relationName, relationBuilder]) =>
    resolveSemanticRelationNode(relationName, relationBuilder.build(), spec, allSpecs),
  );

  return {
    modelName: spec.modelName,
    tableName: spec.tableName,
    fields,
    ...(idConstraint
      ? {
          id: {
            columns: mapFieldNamesToColumnNames(
              spec.modelName,
              idConstraint.fields,
              spec.fieldToColumn,
            ),
            ...(idConstraint.name ? { name: idConstraint.name } : {}),
          } satisfies SqlSemanticPrimaryKeyNode,
        }
      : {}),
    ...(uniques.length > 0 ? { uniques } : {}),
    ...(indexes.length > 0 ? { indexes } : {}),
    ...(foreignKeys.length > 0 ? { foreignKeys } : {}),
    ...(relations.length > 0 ? { relations } : {}),
  };
}

export function buildSqlContractFromSemanticDefinition(
  definition: SqlSemanticContractDefinition,
): ContractIR {
  return buildSemanticSqlContract(
    definition,
    () => new SqlContractBuilder() as unknown as SqlSemanticContractBuilderLike,
  );
}

function buildStagedContract<Definition extends StagedContractInput>(
  definition: Definition,
): BuiltStagedContract<Definition> {
  const storageTypes = { ...(definition.types ?? {}) } as Record<string, StorageTypeInstance>;
  const models = { ...(definition.models ?? {}) } as Record<string, RuntimeStagedModel>;

  emitTypedNamedTypeFallbackWarnings(models, storageTypes);

  const modelSpecs = new Map<string, RuntimeModelSpec>();
  for (const [modelName, modelDefinition] of Object.entries(models)) {
    const tokenModelName = modelDefinition.stageOne.modelName;
    if (tokenModelName && tokenModelName !== modelName) {
      throw new Error(
        `Model token "${tokenModelName}" must be assigned to models.${tokenModelName}. Received models.${modelName}.`,
      );
    }

    const attributesSpec = modelDefinition.buildAttributesSpec();
    const sqlSpec = modelDefinition.buildSqlSpec();
    const tableName = sqlSpec?.table ?? applyNaming(modelName, definition.naming?.tables);
    const fieldToColumn: Record<string, string> = {};

    for (const [fieldName, fieldBuilder] of Object.entries(modelDefinition.stageOne.fields)) {
      const fieldState = fieldBuilder.build();
      fieldToColumn[fieldName] =
        fieldState.columnName ?? applyNaming(fieldName, definition.naming?.columns);
    }

    modelSpecs.set(modelName, {
      modelName,
      tableName,
      fieldBuilders: modelDefinition.stageOne.fields,
      fieldToColumn,
      relations: modelDefinition.stageOne.relations,
      attributesSpec,
      sqlSpec,
    });
  }

  emitTypedCrossModelFallbackWarnings(modelSpecs, models);

  const semanticModels = Array.from(modelSpecs.values()).map((spec) =>
    resolveSemanticModelNode(spec, modelSpecs, storageTypes),
  );

  return buildSqlContractFromSemanticDefinition({
    target: definition.target,
    ...(definition.extensionPacks ? { extensionPacks: definition.extensionPacks } : {}),
    ...(definition.capabilities ? { capabilities: definition.capabilities } : {}),
    ...(definition.storageHash ? { storageHash: definition.storageHash } : {}),
    ...(definition.foreignKeyDefaults ? { foreignKeyDefaults: definition.foreignKeyDefaults } : {}),
    ...(Object.keys(storageTypes).length > 0 ? { storageTypes } : {}),
    models: semanticModels,
  }) as BuiltStagedContract<Definition>;
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
    type BuiltContract = Target extends string
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

    assertStorageSemantics(contract.storage as SqlStorage);

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
    ExtensionPacks,
    Capabilities
  > {
    if (!this.state.target) {
      throw new Error('extensionPacks() requires target() to be called first');
    }

    const namespaces = new Set(this.state.extensionNamespaces ?? []);

    for (const packRef of Object.values(packs) as ExtensionPackRef<'sql', string>[]) {
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
      CodecTypes & MergeExtensionCodecTypes<Packs>,
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

type StagedContractDefinition<
  Target extends TargetPackRef<'sql', string>,
  Types extends Record<string, StorageTypeInstance>,
  Models extends Record<string, StagedModelLike>,
  ExtensionPacks extends Record<string, ExtensionPackRef<'sql', string>> | undefined,
  Capabilities extends Record<string, Record<string, boolean>> | undefined,
  Naming extends StagedContractInput['naming'] | undefined,
  StorageHash extends string | undefined,
  ForeignKeyDefaults extends ForeignKeyDefaultsState | undefined,
> = {
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
  Target extends TargetPackRef<'sql', string>,
  ExtensionPacks extends Record<string, ExtensionPackRef<'sql', string>> | undefined,
  Capabilities extends Record<string, Record<string, boolean>> | undefined,
  Naming extends StagedContractInput['naming'] | undefined,
  StorageHash extends string | undefined,
  ForeignKeyDefaults extends ForeignKeyDefaultsState | undefined,
> = {
  readonly target: Target;
  readonly extensionPacks?: ExtensionPacks;
  readonly naming?: Naming;
  readonly storageHash?: StorageHash;
  readonly foreignKeyDefaults?: ForeignKeyDefaults;
  readonly capabilities?: Capabilities;
};

type StagedContractFactory<
  Target extends TargetPackRef<'sql', string>,
  Types extends Record<string, StorageTypeInstance>,
  Models extends Record<string, StagedModelLike>,
  ExtensionPacks extends Record<string, ExtensionPackRef<'sql', string>> | undefined,
> = (helpers: ComposedAuthoringHelpers<Target, ExtensionPacks>) => {
  readonly types?: Types;
  readonly models?: Models;
};

export function defineContract<
  CodecTypes extends Record<string, { output: unknown }> = Record<string, never>,
>(): SqlContractBuilder<CodecTypes>;
export function defineContract<
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
    Target,
    Types,
    Models,
    ExtensionPacks,
    Capabilities,
    Naming,
    StorageHash,
    ForeignKeyDefaults
  >,
): BuiltStagedContract<
  StagedContractDefinition<
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
    Target,
    ExtensionPacks,
    Capabilities,
    Naming,
    StorageHash,
    ForeignKeyDefaults
  >,
  factory: StagedContractFactory<Target, Types, Models, ExtensionPacks>,
): BuiltStagedContract<
  StagedContractDefinition<
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
    TargetPackRef<'sql', string>,
    Record<string, StorageTypeInstance>,
    Record<string, StagedModelLike>,
    Record<string, ExtensionPackRef<'sql', string>> | undefined
  >,
): SqlContractBuilder<CodecTypes> | BuiltStagedContract<StagedContractInput> {
  if (definition && isStagedContractInput(definition)) {
    if (factory) {
      const builtDefinition = {
        ...definition,
        ...factory(
          createComposedAuthoringHelpers({
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
