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
import type {
  AttributeStageIdFieldNames,
  FieldStateOf,
  ScalarFieldBuilder,
} from './staged-contract-dsl';

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
  Present<
    StagedModelSql<Definition, ModelName> extends { readonly table?: infer TableName }
      ? TableName
      : never
  >,
] extends [never]
  ? ApplyNamingType<ModelName, StagedDefinitionTableNaming<Definition>>
  : Present<
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

type StagedAttributeIdName<Definition, ModelName extends StagedModelNames<Definition>> = Present<
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
  ? Present<StagedInlineIdName<Definition, ModelName>>
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
      readonly fields: {
        readonly [FieldName in StagedModelFieldNames<Definition, ModelName>]: {
          readonly column: StagedModelColumnName<Definition, ModelName, FieldName>;
        };
      };
    };
    readonly fields: {
      readonly [FieldName in StagedModelFieldNames<Definition, ModelName>]: {
        readonly codecId: StagedModelStorageColumn<Definition, ModelName, FieldName>['codecId'];
        readonly nullable: StagedModelStorageColumn<Definition, ModelName, FieldName>['nullable'];
      };
    };
    readonly relations: Record<string, ContractRelation>;
  };
};

type StagedBuiltModelColumnMappings<
  Definition,
  ModelName extends StagedModelNames<Definition>,
> = StagedBuiltModels<Definition>[ModelName]['storage']['fields'];

type StagedBuiltModelTableName<
  Definition,
  ModelName extends StagedModelNames<Definition>,
> = StagedBuiltModels<Definition>[ModelName]['storage']['table'];

type StagedBuiltStorageTableColumns<Definition, ModelName extends StagedModelNames<Definition>> = {
  readonly [FieldName in keyof StagedBuiltModelColumnMappings<Definition, ModelName> &
    string as StagedBuiltModelColumnMappings<
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
  readonly storageHash: StorageHashBase<string>;
  readonly tables: StagedBuiltStorageTables<Definition>;
  readonly types: StagedDefinitionTypes<Definition>;
};

export type SqlContractResult<Definition> = ContractWithTypeMaps<
  Contract<StagedBuiltStorage<Definition>, StagedBuiltModels<Definition>> & {
    readonly target: StagedDefinitionTargetId<Definition>;
    readonly targetFamily: 'sql';
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
