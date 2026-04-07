import type { Contract, ContractModel, StorageBase } from '@prisma-next/contract/types';

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

export type InferModelRow<
  TContract extends MongoContractWithTypeMaps<MongoContract, MongoTypeMaps>,
  ModelName extends string & keyof TContract['models'],
  TFields extends Record<
    string,
    { type: { kind: 'scalar'; codecId: string }; nullable: boolean }
  > = TContract['models'][ModelName]['fields'],
  TCodecTypes extends Record<string, { output: unknown }> = ExtractMongoCodecTypes<TContract>,
> = {
  -readonly [FieldName in keyof TFields]: TFields[FieldName]['nullable'] extends true
    ? TCodecTypes[TFields[FieldName]['type']['codecId']]['output'] | null
    : TCodecTypes[TFields[FieldName]['type']['codecId']]['output'];
};
