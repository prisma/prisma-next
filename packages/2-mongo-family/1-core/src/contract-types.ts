// --- Storage layer: collection-level metadata ---

export type MongoStorageCollection = Record<string, never>;

export type MongoStorage = {
  readonly collections: Record<string, MongoStorageCollection>;
};

// --- Model field (domain level) ---

export type MongoModelField = {
  readonly codecId: string;
  readonly nullable: boolean;
};

// --- Model storage (family-specific bridge) ---

export type MongoModelStorage = {
  readonly collection?: string;
};

// --- Polymorphism ---

export type MongoDiscriminator = {
  readonly field: string;
};

export type MongoVariantEntry = {
  readonly value: string;
};

// --- Relations ---

export type MongoReferenceRelationOn = {
  readonly localFields: readonly string[];
  readonly targetFields: readonly string[];
};

export type MongoReferenceRelation = {
  readonly to: string;
  readonly cardinality: '1:1' | '1:N' | 'N:1';
  readonly strategy: 'reference';
  readonly on: MongoReferenceRelationOn;
};

export type MongoEmbedRelation = {
  readonly to: string;
  readonly cardinality: '1:1' | '1:N';
  readonly strategy: 'embed';
  readonly field: string;
};

export type MongoRelation = MongoReferenceRelation | MongoEmbedRelation;

// --- Model definition ---

export type MongoModelDefinition = {
  readonly fields: Record<string, MongoModelField>;
  readonly storage: MongoModelStorage;
  readonly relations: Record<string, MongoRelation>;
  readonly discriminator?: MongoDiscriminator;
  readonly variants?: Record<string, MongoVariantEntry>;
};

// --- Contract ---

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

// --- TypeMaps: phantom type attachment ---

export type MongoTypeMaps<
  TCodecTypes extends Record<string, { output: unknown }> = Record<string, { output: unknown }>,
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

// --- Row inference ---

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
