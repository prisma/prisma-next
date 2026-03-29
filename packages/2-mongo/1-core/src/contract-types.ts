// --- Storage layer: collection-level metadata ---
// Future: indexes, validators, capped settings, collation, time series config
export type MongoStorageCollection = Record<string, never>;

export type MongoStorage = {
  readonly collections: Record<string, MongoStorageCollection>;
};

// --- Model layer: application's view of the data ---

export type MongoModelField = {
  readonly codecId: string;
  readonly nullable: boolean;
};

export type MongoModelStorage = {
  readonly collection: string;
};

export type MongoModelDefinition = {
  readonly storage: MongoModelStorage;
  readonly fields: Record<string, MongoModelField>;
  readonly relations: Record<string, unknown>;
};

// --- Mappings: model name <-> collection name only ---

export type MongoMappings = {
  readonly modelToCollection?: Record<string, string>;
  readonly collectionToModel?: Record<string, string>;
};

// --- Contract: top-level container ---

export type MongoContract<
  S extends MongoStorage = MongoStorage,
  M extends Record<string, MongoModelDefinition> = Record<string, MongoModelDefinition>,
  R extends Record<string, unknown> = Record<string, unknown>,
  Map extends MongoMappings = MongoMappings,
> = {
  readonly targetFamily: string;
  readonly storage: S;
  readonly models: M;
  readonly relations: R;
  readonly mappings: Map;
};

// --- TypeMaps: phantom type attachment ---

export type MongoTypeMaps<
  TCodecTypes extends Record<string, { output: unknown }> = Record<string, never>,
> = {
  readonly codecTypes: TCodecTypes;
};

export type MongoTypeMapsPhantomKey = '__@prisma-next/mongo-core/typeMaps@__';

export type MongoContractWithTypeMaps<TContract, TTypeMaps> = TContract & {
  readonly [K in MongoTypeMapsPhantomKey]?: TTypeMaps;
};

// --- Type extraction helpers ---

export type ExtractMongoTypeMaps<T> = MongoTypeMapsPhantomKey extends keyof T
  ? NonNullable<T[MongoTypeMapsPhantomKey & keyof T]>
  : never;

export type ExtractMongoCodecTypes<T> =
  ExtractMongoTypeMaps<T> extends { codecTypes: infer C }
    ? C extends Record<string, { output: unknown }>
      ? C
      : Record<string, never>
    : Record<string, never>;
