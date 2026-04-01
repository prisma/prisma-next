import type {
  DomainDiscriminator,
  DomainField,
  DomainRelation,
  DomainVariantEntry,
} from '@prisma-next/contract/types';

export type MongoStorageCollection = Record<string, never>;

export type MongoStorage = {
  readonly collections: Record<string, MongoStorageCollection>;
};

export type MongoModelStorage = {
  readonly collection?: string;
  readonly relations?: Record<string, { readonly field: string }>;
};

export type MongoModelDefinition = {
  readonly fields: Record<string, DomainField>;
  readonly storage: MongoModelStorage;
  readonly relations: Record<string, DomainRelation>;
  readonly discriminator?: DomainDiscriminator;
  readonly variants?: Record<string, DomainVariantEntry>;
  readonly base?: string;
  readonly owner?: string;
};

export type MongoContract<
  Roots extends Record<string, string> = Record<string, string>,
  S extends MongoStorage = MongoStorage,
  M extends Record<string, MongoModelDefinition> = Record<string, MongoModelDefinition>,
> = {
  readonly targetFamily: string;
  readonly roots: Roots;
  readonly storage: S;
  readonly models: M;
};

export type MongoTypeMaps<
  TCodecTypes extends Record<string, { output: unknown }> = Record<string, { output: unknown }>,
> = {
  readonly codecTypes: TCodecTypes;
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
    { codecId: string; nullable: boolean }
  > = TContract['models'][ModelName]['fields'],
  TCodecTypes extends Record<string, { output: unknown }> = ExtractMongoCodecTypes<TContract>,
> = {
  -readonly [FieldName in keyof TFields]: TFields[FieldName]['nullable'] extends true
    ? TCodecTypes[TFields[FieldName]['codecId']]['output'] | null
    : TCodecTypes[TFields[FieldName]['codecId']]['output'];
};
