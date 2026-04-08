import type {
  ColumnDefault,
  Contract,
  ContractRelation,
  StorageHashBase,
} from '@prisma-next/contract/types';
import type { ExtensionPackRef, TargetPackRef } from '@prisma-next/framework-components/components';
import type {
  ContractWithTypeMaps,
  Index,
  ReferentialAction,
  StorageTypeInstance,
  TypeMaps,
} from '@prisma-next/sql-contract/types';
import type { UnionToIntersection } from './authoring-type-utils';
import type { AttributeStageIdFieldNames, FieldStateOf, ScalarFieldBuilder } from './contract-dsl';

export type ExtractCodecTypesFromPack<P> = P extends { __codecTypes?: infer C }
  ? C extends Record<string, { output: unknown }>
    ? C
    : Record<string, never>
  : Record<string, never>;

export type MergeExtensionCodecTypes<Packs extends Record<string, unknown>> = UnionToIntersection<
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

export type MergeExtensionPackRefs<
  Existing extends Record<string, unknown> | undefined,
  Added extends Record<string, ExtensionPackRef<'sql', string>>,
> = Existing extends Record<string, unknown> ? Existing & Added : Added;

type DefinitionExtensionPacks<Definition> = Definition extends {
  readonly extensionPacks?: infer Packs extends Record<string, ExtensionPackRef<'sql', string>>;
}
  ? Packs
  : Record<never, never>;

type DefinitionCapabilities<Definition> = Definition extends {
  readonly capabilities?: infer Capabilities extends Record<string, Record<string, boolean>>;
}
  ? Capabilities
  : undefined;

type DefinitionTargetId<Definition> = Definition extends {
  readonly target: TargetPackRef<'sql', infer Target>;
}
  ? Target
  : never;

type Present<T> = Exclude<T, undefined>;

type CodecTypesFromDefinition<Definition> = ExtractCodecTypesFromPack<
  Definition extends { readonly target: infer Target } ? Target : never
> &
  MergeExtensionCodecTypesSafe<DefinitionExtensionPacks<Definition>>;

type DefinitionModels<Definition> = Definition extends {
  readonly models?: unknown;
}
  ? Present<Definition['models']> extends Record<string, unknown>
    ? Present<Definition['models']>
    : Record<never, never>
  : Record<never, never>;

type DefinitionTypes<Definition> = Definition extends {
  readonly types?: unknown;
}
  ? Present<Definition['types']> extends Record<string, StorageTypeInstance>
    ? Present<Definition['types']>
    : Record<never, never>
  : Record<never, never>;

type DefinitionTableNaming<Definition> = Definition extends {
  readonly naming?: { readonly tables?: infer Strategy extends string };
}
  ? Strategy
  : undefined;

type DefinitionColumnNaming<Definition> = Definition extends {
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
    : PrevKind extends 'lower' | 'other'
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

type ModelNames<Definition> = keyof DefinitionModels<Definition> & string;

type ModelFields<
  Definition,
  ModelName extends ModelNames<Definition>,
> = DefinitionModels<Definition>[ModelName] extends {
  readonly stageOne: {
    readonly fields: Record<string, ScalarFieldBuilder>;
  };
}
  ? DefinitionModels<Definition>[ModelName]['stageOne']['fields']
  : Record<never, never>;

type ModelFieldNames<Definition, ModelName extends ModelNames<Definition>> = keyof ModelFields<
  Definition,
  ModelName
> &
  string;

type StagedModelRelations<
  Definition,
  ModelName extends StagedModelNames<Definition>,
> = StagedDefinitionModels<Definition>[ModelName] extends {
  readonly stageOne: { readonly relations: infer R };
}
  ? R extends Record<string, unknown>
    ? R
    : Record<never, never>
  : Record<never, never>;

type StagedModelRelationNames<
  Definition,
  ModelName extends StagedModelNames<Definition>,
> = keyof StagedModelRelations<Definition, ModelName> & string;

type ModelFieldState<
  Definition,
  ModelName extends ModelNames<Definition>,
  FieldName extends ModelFieldNames<Definition, ModelName>,
> = FieldStateOf<ModelFields<Definition, ModelName>[FieldName]>;

type ModelSql<
  Definition,
  ModelName extends ModelNames<Definition>,
> = DefinitionModels<Definition>[ModelName] extends {
  readonly __sql: infer SqlSpec;
}
  ? SqlSpec
  : undefined;

type ModelAttributes<
  Definition,
  ModelName extends ModelNames<Definition>,
> = DefinitionModels<Definition>[ModelName] extends {
  readonly __attributes: infer AttributesSpec;
}
  ? AttributesSpec
  : undefined;

type FieldDescriptorOf<FieldState> = Present<
  FieldState extends { readonly descriptor?: infer Descriptor } ? Descriptor : never
>;

type FieldTypeRefOf<FieldState> = Present<
  FieldState extends { readonly typeRef?: infer TypeRef } ? TypeRef : never
>;

type FieldNullableOf<FieldState> = FieldState extends {
  readonly nullable: infer Nullable extends boolean;
}
  ? Nullable
  : boolean;

type FieldColumnOverrideOf<FieldState> = Present<
  FieldState extends { readonly columnName?: infer ColumnName } ? ColumnName : never
>;

type FieldInlineIdSpecOf<FieldState> = Present<
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
  [TypeName in keyof DefinitionTypes<Definition> & string]: [TypeRef] extends [
    DefinitionTypes<Definition>[TypeName],
  ]
    ? [DefinitionTypes<Definition>[TypeName]] extends [TypeRef]
      ? TypeName
      : never
    : never;
}[keyof DefinitionTypes<Definition> & string];

type ResolveNamedStorageTypeKey<Definition, TypeRef> = TypeRef extends string
  ? TypeRef
  : TypeRef extends StorageTypeInstance
    ? [LookupNamedStorageTypeKeyByValue<Definition, TypeRef>] extends [never]
      ? string
      : LookupNamedStorageTypeKeyByValue<Definition, TypeRef>
    : never;

type ResolveNamedStorageType<Definition, TypeRef> =
  ResolveNamedStorageTypeKey<Definition, TypeRef> extends infer TypeName extends string
    ? TypeName extends keyof DefinitionTypes<Definition>
      ? DefinitionTypes<Definition>[TypeName]
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

type ModelTableName<Definition, ModelName extends ModelNames<Definition>> = [
  Present<
    ModelSql<Definition, ModelName> extends { readonly table?: infer TableName } ? TableName : never
  >,
] extends [never]
  ? ApplyNamingType<ModelName, DefinitionTableNaming<Definition>>
  : Present<
        ModelSql<Definition, ModelName> extends { readonly table?: infer TableName }
          ? TableName
          : never
      > extends infer ExplicitTableName extends string
    ? ExplicitTableName
    : ApplyNamingType<ModelName, DefinitionTableNaming<Definition>>;

type ModelColumnName<
  Definition,
  ModelName extends ModelNames<Definition>,
  FieldName extends ModelFieldNames<Definition, ModelName>,
> = [FieldColumnOverrideOf<ModelFieldState<Definition, ModelName, FieldName>>] extends [never]
  ? ApplyNamingType<FieldName, DefinitionColumnNaming<Definition>>
  : FieldColumnOverrideOf<
        ModelFieldState<Definition, ModelName, FieldName>
      > extends infer ExplicitColumnName extends string
    ? ExplicitColumnName
    : ApplyNamingType<FieldName, DefinitionColumnNaming<Definition>>;

type FieldNamesToColumnNames<
  Definition,
  ModelName extends ModelNames<Definition>,
  FieldNames extends readonly string[],
> = FieldNames extends readonly []
  ? readonly []
  : FieldNames extends readonly [
        infer First extends ModelFieldNames<Definition, ModelName>,
        ...infer Rest extends readonly string[],
      ]
    ? readonly [
        ModelColumnName<Definition, ModelName, First>,
        ...FieldNamesToColumnNames<Definition, ModelName, Rest>,
      ]
    : readonly string[];

type InlineIdFieldName<Definition, ModelName extends ModelNames<Definition>> = {
  [FieldName in ModelFieldNames<Definition, ModelName>]: [
    FieldInlineIdSpecOf<ModelFieldState<Definition, ModelName, FieldName>>,
  ] extends [never]
    ? never
    : FieldName;
}[ModelFieldNames<Definition, ModelName>];

type InlineIdFieldNames<Definition, ModelName extends ModelNames<Definition>> = [
  InlineIdFieldName<Definition, ModelName>,
] extends [never]
  ? undefined
  : readonly [InlineIdFieldName<Definition, ModelName>];

type InlineIdName<Definition, ModelName extends ModelNames<Definition>> = {
  [FieldName in ModelFieldNames<Definition, ModelName>]: FieldInlineIdSpecOf<
    ModelFieldState<Definition, ModelName, FieldName>
  > extends { readonly name?: infer Name extends string }
    ? Name
    : never;
}[ModelFieldNames<Definition, ModelName>];

type AttributeIdFieldNames<
  Definition,
  ModelName extends ModelNames<Definition>,
> = AttributeStageIdFieldNames<ModelAttributes<Definition, ModelName>>;

type AttributeIdName<Definition, ModelName extends ModelNames<Definition>> = Present<
  ModelAttributes<Definition, ModelName> extends {
    readonly id?: { readonly name?: infer Name extends string };
  }
    ? Name
    : never
>;

type ModelIdFieldNames<Definition, ModelName extends ModelNames<Definition>> = [
  AttributeIdFieldNames<Definition, ModelName>,
] extends [undefined]
  ? InlineIdFieldNames<Definition, ModelName>
  : AttributeIdFieldNames<Definition, ModelName>;

type ModelIdName<Definition, ModelName extends ModelNames<Definition>> = [
  AttributeIdName<Definition, ModelName>,
] extends [never]
  ? Present<InlineIdName<Definition, ModelName>>
  : AttributeIdName<Definition, ModelName>;

type StorageColumn<
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

type ModelStorageColumn<
  Definition,
  ModelName extends ModelNames<Definition>,
  FieldName extends string,
> = FieldName extends ModelFieldNames<Definition, ModelName>
  ? StorageColumn<
      DescriptorCodecId<
        ResolveFieldDescriptor<Definition, ModelFieldState<Definition, ModelName, FieldName>>
      >,
      FieldNullableOf<ModelFieldState<Definition, ModelName, FieldName>>,
      DescriptorNativeType<
        ResolveFieldDescriptor<Definition, ModelFieldState<Definition, ModelName, FieldName>>
      >,
      ResolveFieldColumnTypeRef<Definition, ModelFieldState<Definition, ModelName, FieldName>>,
      ResolveFieldColumnTypeParams<Definition, ModelFieldState<Definition, ModelName, FieldName>>
    >
  : never;

type BuiltModels<Definition> = {
  readonly [ModelName in ModelNames<Definition>]: {
    readonly storage: {
      readonly table: ModelTableName<Definition, ModelName>;
      readonly fields: {
        readonly [FieldName in ModelFieldNames<Definition, ModelName>]: {
          readonly column: ModelColumnName<Definition, ModelName, FieldName>;
        };
      };
    };
    readonly fields: {
      readonly [FieldName in ModelFieldNames<Definition, ModelName>]: {
        readonly nullable: ModelStorageColumn<Definition, ModelName, FieldName>['nullable'];
        readonly type: {
          readonly kind: 'scalar';
          readonly codecId: ModelStorageColumn<Definition, ModelName, FieldName>['codecId'];
        };
      };
    };
    readonly relations: {
      readonly [RelName in StagedModelRelationNames<Definition, ModelName>]: ContractRelation;
    };
  };
};

type BuiltModelColumnMappings<
  Definition,
  ModelName extends ModelNames<Definition>,
> = BuiltModels<Definition>[ModelName]['storage']['fields'];

type BuiltModelTableName<
  Definition,
  ModelName extends ModelNames<Definition>,
> = BuiltModels<Definition>[ModelName]['storage']['table'];

type BuiltStorageTableColumns<Definition, ModelName extends ModelNames<Definition>> = {
  readonly [FieldName in keyof BuiltModelColumnMappings<Definition, ModelName> &
    string as BuiltModelColumnMappings<
    Definition,
    ModelName
  >[FieldName]['column']]: ModelStorageColumn<Definition, ModelName, FieldName>;
};

type BuiltStorageTables<Definition> = {
  readonly [ModelName in ModelNames<Definition> as BuiltModelTableName<Definition, ModelName>]: {
    readonly columns: BuiltStorageTableColumns<Definition, ModelName>;
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
  } & (ModelIdFieldNames<Definition, ModelName> extends readonly string[]
    ? {
        readonly primaryKey: {
          readonly columns: FieldNamesToColumnNames<
            Definition,
            ModelName,
            ModelIdFieldNames<Definition, ModelName>
          >;
          readonly name?: ModelIdName<Definition, ModelName>;
        };
      }
    : Record<string, never>);
};

type BuiltStorage<Definition> = {
  readonly storageHash: StorageHashBase<string>;
  readonly tables: BuiltStorageTables<Definition>;
  readonly types: DefinitionTypes<Definition>;
};

type FieldOutputType<
  Definition,
  ModelName extends ModelNames<Definition>,
  FieldName extends ModelFieldNames<Definition, ModelName>,
> = ModelStorageColumn<Definition, ModelName, FieldName> extends infer Col
  ? Col extends { readonly codecId: infer Id extends string }
    ? Id extends keyof CodecTypesFromDefinition<Definition>
      ? CodecTypesFromDefinition<Definition>[Id] extends { readonly output: infer O }
        ? Col extends { readonly nullable: true }
          ? O | null
          : O
        : unknown
      : unknown
    : unknown
  : unknown;

type FieldOutputTypes<Definition> = {
  readonly [ModelName in ModelNames<Definition>]: {
    readonly [FieldName in ModelFieldNames<Definition, ModelName>]: FieldOutputType<
      Definition,
      ModelName,
      FieldName
    >;
  };
};

export type SqlContractResult<Definition> = ContractWithTypeMaps<
  Contract<BuiltStorage<Definition>, BuiltModels<Definition>> & {
    readonly target: DefinitionTargetId<Definition>;
    readonly targetFamily: 'sql';
  } & {
    readonly extensionPacks: keyof DefinitionExtensionPacks<Definition> extends never
      ? Record<string, never>
      : DefinitionExtensionPacks<Definition>;
    readonly capabilities: DefinitionCapabilities<Definition> extends Record<
      string,
      Record<string, boolean>
    >
      ? DefinitionCapabilities<Definition>
      : Record<string, Record<string, boolean>>;
  },
  TypeMaps<
    CodecTypesFromDefinition<Definition>,
    Record<string, never>,
    Record<string, never>,
    FieldOutputTypes<Definition>
  >
>;
