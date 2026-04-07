import type {
  Contract,
  ContractField,
  ContractModel,
  ContractValueObject,
  StorageBase,
} from '@prisma-next/contract/types';

export type MongoStorageCollection = Record<string, never>;

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
> = {
  readonly codecTypes: TCodecTypes;
  readonly operationTypes: TOperationTypes;
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

type ExtractValueObjects<TContract> = TContract extends {
  valueObjects: infer VO extends Record<string, ContractValueObject>;
}
  ? VO
  : Record<string, never>;

type InferFieldBaseType<
  TFieldType,
  TValueObjects extends Record<string, ContractValueObject>,
  TCodecTypes extends Record<string, { output: unknown }>,
> = TFieldType extends { kind: 'scalar'; codecId: infer CId extends string & keyof TCodecTypes }
  ? TCodecTypes[CId]['output']
  : TFieldType extends { kind: 'valueObject'; name: infer VOName extends string }
    ? VOName extends keyof TValueObjects
      ? {
          -readonly [K in keyof TValueObjects[VOName]['fields']]: InferFieldType<
            TValueObjects[VOName]['fields'][K],
            TValueObjects,
            TCodecTypes
          >;
        }
      : unknown
    : unknown;

type InferFieldType<
  TField extends ContractField,
  TValueObjects extends Record<string, ContractValueObject>,
  TCodecTypes extends Record<string, { output: unknown }>,
> = TField extends { many: true }
  ? TField['nullable'] extends true
    ? InferFieldBaseType<TField['type'], TValueObjects, TCodecTypes>[] | null
    : InferFieldBaseType<TField['type'], TValueObjects, TCodecTypes>[]
  : TField['nullable'] extends true
    ? InferFieldBaseType<TField['type'], TValueObjects, TCodecTypes> | null
    : InferFieldBaseType<TField['type'], TValueObjects, TCodecTypes>;

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
