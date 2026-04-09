import type {
  Contract,
  ContractField,
  ContractModel,
  ContractValueObject,
  StorageBase,
} from '@prisma-next/contract/types';

export type MongoIndexFieldValue = 1 | -1 | 'text' | '2dsphere' | '2d' | 'hashed';

export type MongoIndexFields = Record<string, MongoIndexFieldValue>;

export type MongoJsonPrimitive = string | number | boolean | null;

export type MongoJsonValue = MongoJsonPrimitive | readonly MongoJsonValue[] | MongoJsonObject;

export type MongoJsonObject = {
  readonly [key: string]: MongoJsonValue;
};

export type MongoCollationCaseFirst = 'off' | 'upper' | 'lower';

export type MongoCollationStrength = 1 | 2 | 3 | 4 | 5;

export type MongoCollationAlternate = 'non-ignorable' | 'shifted';

export type MongoCollationMaxVariable = 'punct' | 'space';

export type MongoCollationOptions = {
  readonly locale: string;
  readonly caseLevel?: boolean;
  readonly caseFirst?: MongoCollationCaseFirst;
  readonly strength?: MongoCollationStrength;
  readonly numericOrdering?: boolean;
  readonly alternate?: MongoCollationAlternate;
  readonly maxVariable?: MongoCollationMaxVariable;
  readonly backwards?: boolean;
  readonly normalization?: boolean;
};

export type MongoWildcardProjection = Readonly<Record<string, 0 | 1>>;

export type MongoIndexOptions = {
  readonly unique?: boolean;
  readonly name?: string;
  readonly partialFilterExpression?: MongoJsonObject;
  readonly sparse?: boolean;
  readonly expireAfterSeconds?: number;
  readonly weights?: Readonly<Record<string, number>>;
  readonly default_language?: string;
  readonly language_override?: string;
  readonly textIndexVersion?: number;
  readonly '2dsphereIndexVersion'?: number;
  readonly bits?: number;
  readonly min?: number;
  readonly max?: number;
  readonly bucketSize?: number;
  readonly hidden?: boolean;
  readonly collation?: MongoCollationOptions;
  readonly wildcardProjection?: MongoWildcardProjection;
};

export type MongoIndex = {
  readonly fields: MongoIndexFields;
  readonly options?: MongoIndexOptions;
};

export type MongoIndexOptionDefaults = {
  readonly storageEngine?: MongoJsonObject;
};

export type MongoTimeSeriesGranularity = 'seconds' | 'minutes' | 'hours';

export type MongoTimeSeriesCollectionOptions = {
  readonly timeField: string;
  readonly metaField?: string;
  readonly granularity?: MongoTimeSeriesGranularity;
  readonly bucketMaxSpanSeconds?: number;
  readonly bucketRoundingSeconds?: number;
};

export type MongoClusteredCollectionKey = Readonly<Record<string, 1>>;

export type MongoClusteredCollectionOptions = {
  readonly name?: string;
  readonly key: MongoClusteredCollectionKey;
  readonly unique: boolean;
};

export type MongoChangeStreamPreAndPostImagesOptions = {
  readonly enabled: boolean;
};

export type MongoCollectionOptions = {
  readonly capped?: boolean;
  readonly size?: number;
  readonly max?: number;
  readonly storageEngine?: MongoJsonObject;
  readonly indexOptionDefaults?: MongoIndexOptionDefaults;
  readonly collation?: MongoCollationOptions;
  readonly timeseries?: MongoTimeSeriesCollectionOptions;
  readonly clusteredIndex?: MongoClusteredCollectionOptions;
  readonly expireAfterSeconds?: number;
  readonly changeStreamPreAndPostImages?: MongoChangeStreamPreAndPostImagesOptions;
};

export type MongoStorageCollection = {
  readonly indexes?: readonly MongoIndex[];
  readonly options?: MongoCollectionOptions;
};

export type MongoStorage<THash extends string = string> = StorageBase<THash> & {
  readonly collections: Record<string, MongoStorageCollection>;
};

export type MongoModelStorage = {
  readonly collection?: string;
  readonly relations?: Record<string, { readonly field: string }>;
};

export type MongoModelDefinition = ContractModel<MongoModelStorage>;

export type MongoContract<
  S extends MongoStorage = MongoStorage,
  M extends Record<string, MongoModelDefinition> = Record<string, MongoModelDefinition>,
> = Contract<S, M>;

export type MongoTypeMaps<
  TCodecTypes extends Record<string, { output: unknown }> = Record<string, { output: unknown }>,
  TOperationTypes extends Record<string, unknown> = Record<string, never>,
  TFieldOutputTypes extends Record<string, Record<string, unknown>> = Record<
    string,
    Record<string, unknown>
  >,
> = {
  readonly codecTypes: TCodecTypes;
  readonly operationTypes: TOperationTypes;
  readonly fieldOutputTypes: TFieldOutputTypes;
};

export type MongoTypeMapsPhantomKey = '__@prisma-next/mongo-core/typeMaps@__';

export type MongoContractWithTypeMaps<TContract, TTypeMaps> = TContract & {
  readonly [K in MongoTypeMapsPhantomKey]?: TTypeMaps;
};

export type ExtractMongoTypeMaps<T> = MongoTypeMapsPhantomKey extends keyof T
  ? NonNullable<T[MongoTypeMapsPhantomKey & keyof T]>
  : never;

export type ExtractMongoCodecTypes<T> =
  ExtractMongoTypeMaps<T> extends { codecTypes: infer C }
    ? C extends Record<string, { output: unknown }>
      ? C
      : Record<string, never>
    : Record<string, never>;

export type ExtractMongoFieldOutputTypes<T> =
  ExtractMongoTypeMaps<T> extends { fieldOutputTypes: infer F }
    ? F extends Record<string, Record<string, unknown>>
      ? F
      : Record<string, never>
    : Record<string, never>;

type ExtractValueObjects<TContract> = TContract extends {
  valueObjects: infer VO extends Record<string, ContractValueObject>;
}
  ? VO
  : Record<never, never>;

type NormalizeContractFields<TFields> = {
  [K in keyof TFields]: TFields[K] extends ContractField ? TFields[K] : never;
};

type ExtractValueObjectFields<
  TValueObjects extends Record<string, ContractValueObject>,
  VOName extends keyof TValueObjects,
> = NormalizeContractFields<TValueObjects[VOName]['fields']>;

type InferFieldBaseType<
  TFieldType,
  TValueObjects extends Record<string, ContractValueObject>,
  TCodecTypes extends Record<string, { output: unknown }>,
> = TFieldType extends { kind: 'scalar'; codecId: infer CId extends string & keyof TCodecTypes }
  ? TCodecTypes[CId]['output']
  : TFieldType extends { kind: 'valueObject'; name: infer VOName extends string }
    ? VOName extends keyof TValueObjects
      ? {
          -readonly [K in keyof ExtractValueObjectFields<TValueObjects, VOName>]: InferFieldType<
            ExtractValueObjectFields<TValueObjects, VOName>[K],
            TValueObjects,
            TCodecTypes
          >;
        }
      : unknown
    : TFieldType extends {
          kind: 'union';
          members: infer TMembers extends ReadonlyArray<unknown>;
        }
      ? TMembers[number] extends infer TMember
        ? InferFieldBaseType<TMember, TValueObjects, TCodecTypes>
        : unknown
      : unknown;

type InferFieldType<
  TField,
  TValueObjects extends Record<string, ContractValueObject>,
  TCodecTypes extends Record<string, { output: unknown }>,
> = TField extends ContractField
  ? TField extends { many: true }
    ? TField['nullable'] extends true
      ? InferFieldBaseType<TField['type'], TValueObjects, TCodecTypes>[] | null
      : InferFieldBaseType<TField['type'], TValueObjects, TCodecTypes>[]
    : TField['nullable'] extends true
      ? InferFieldBaseType<TField['type'], TValueObjects, TCodecTypes> | null
      : InferFieldBaseType<TField['type'], TValueObjects, TCodecTypes>
  : never;

export type InferModelRow<
  TContract extends MongoContractWithTypeMaps<MongoContract, MongoTypeMaps>,
  ModelName extends string & keyof TContract['models'],
  TFields extends Record<string, ContractField> = TContract['models'][ModelName]['fields'],
  TCodecTypes extends Record<string, { output: unknown }> = ExtractMongoCodecTypes<TContract>,
  TValueObjects extends Record<string, ContractValueObject> = ExtractValueObjects<TContract>,
> = {
  -readonly [FieldName in keyof TFields]: InferFieldType<
    TFields[FieldName],
    TValueObjects,
    TCodecTypes
  >;
};
