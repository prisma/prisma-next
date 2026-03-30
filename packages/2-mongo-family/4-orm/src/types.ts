import type {
  ExtractMongoCodecTypes,
  InferModelRow,
  MongoContract,
  MongoContractWithTypeMaps,
  MongoQueryPlan,
  MongoTypeMaps,
} from '@prisma-next/mongo-core';
import type { AsyncIterableResult } from '@prisma-next/runtime-executor';

export interface MongoQueryExecutor {
  execute<Row>(plan: MongoQueryPlan<Row>): AsyncIterableResult<Row>;
}

export interface MongoOrmOptions<TContract extends MongoContract> {
  readonly contract: TContract;
  readonly executor: MongoQueryExecutor;
}

// --- Relation type helpers ---

export type ReferenceRelationKeys<
  TContract extends MongoContract,
  ModelName extends string & keyof TContract['models'],
> = {
  [K in keyof TContract['models'][ModelName]['relations']]: TContract['models'][ModelName]['relations'][K] extends {
    readonly strategy: 'reference';
  }
    ? K
    : never;
}[keyof TContract['models'][ModelName]['relations']];

export type EmbedRelationKeys<
  TContract extends MongoContract,
  ModelName extends string & keyof TContract['models'],
> = {
  [K in keyof TContract['models'][ModelName]['relations']]: TContract['models'][ModelName]['relations'][K] extends {
    readonly strategy: 'embed';
  }
    ? K
    : never;
}[keyof TContract['models'][ModelName]['relations']];

// --- Embedded field types ---

type EmbedRelationRowType<
  TContract extends MongoContractWithTypeMaps<MongoContract, MongoTypeMaps>,
  ModelName extends string & keyof TContract['models'],
  RelKey extends keyof TContract['models'][ModelName]['relations'],
> = TContract['models'][ModelName]['relations'][RelKey] extends {
  readonly to: infer To extends string & keyof TContract['models'];
  readonly cardinality: infer C;
  readonly strategy: 'embed';
}
  ? C extends '1:N'
    ? InferModelRow<TContract, To>[]
    : InferModelRow<TContract, To>
  : never;

type EmbedRelationFields<
  TContract extends MongoContractWithTypeMaps<MongoContract, MongoTypeMaps>,
  ModelName extends string & keyof TContract['models'],
> = EmbedRelationKeys<TContract, ModelName> extends never
  ? {}
  : {
      -readonly [K in EmbedRelationKeys<TContract, ModelName> &
        keyof TContract['models'][ModelName]['relations']]: EmbedRelationRowType<
        TContract,
        ModelName,
        K
      >;
    };

export type InferFullRow<
  TContract extends MongoContractWithTypeMaps<MongoContract, MongoTypeMaps>,
  ModelName extends string & keyof TContract['models'],
> = InferModelRow<TContract, ModelName> & EmbedRelationFields<TContract, ModelName>;

// --- Polymorphic row type ---

type VariantRow<
  TContract extends MongoContractWithTypeMaps<MongoContract, MongoTypeMaps>,
  ModelName extends string & keyof TContract['models'],
> = TContract['models'][ModelName] extends {
  readonly variants: infer V;
}
  ? V extends Record<string, unknown>
    ? {
        [VK in keyof V]: VK extends string & keyof TContract['models']
          ? InferFullRow<TContract, ModelName> & InferFullRow<TContract, VK>
          : never;
      }[keyof V]
    : InferFullRow<TContract, ModelName>
  : InferFullRow<TContract, ModelName>;

export type InferRootRow<
  TContract extends MongoContractWithTypeMaps<MongoContract, MongoTypeMaps>,
  ModelName extends string & keyof TContract['models'],
> = VariantRow<TContract, ModelName>;

// --- Include result type augmentation ---

type IncludeRelationRowType<
  TContract extends MongoContractWithTypeMaps<MongoContract, MongoTypeMaps>,
  ModelName extends string & keyof TContract['models'],
  RelKey extends keyof TContract['models'][ModelName]['relations'],
> = TContract['models'][ModelName]['relations'][RelKey] extends {
  readonly to: infer To extends string & keyof TContract['models'];
  readonly cardinality: infer C;
  readonly strategy: 'reference';
}
  ? C extends 'N:1' | '1:1'
    ? InferFullRow<TContract, To> | null
    : InferFullRow<TContract, To>[]
  : never;

export type IncludeResultFields<
  TContract extends MongoContractWithTypeMaps<MongoContract, MongoTypeMaps>,
  ModelName extends string & keyof TContract['models'],
  TInclude extends MongoIncludeSpec<TContract, ModelName>,
> = {
  -readonly [K in keyof TInclude & string as TInclude[K] extends true
    ? K
    : never]: K extends keyof TContract['models'][ModelName]['relations']
    ? IncludeRelationRowType<TContract, ModelName, K>
    : never;
};

// --- Query options ---

export type MongoWhereFilter<
  TContract extends MongoContractWithTypeMaps<MongoContract, MongoTypeMaps>,
  ModelName extends string & keyof TContract['models'],
  TCodecTypes extends Record<string, { output: unknown }> = ExtractMongoCodecTypes<TContract>,
> = {
  readonly [K in keyof TContract['models'][ModelName]['fields']]?: TContract['models'][ModelName]['fields'][K] extends {
    readonly codecId: infer CId extends string & keyof TCodecTypes;
  }
    ? TCodecTypes[CId]['output']
    : unknown;
};

export type MongoIncludeSpec<
  TContract extends MongoContract,
  ModelName extends string & keyof TContract['models'],
> = {
  readonly [K in ReferenceRelationKeys<TContract, ModelName>]?: true;
};

export interface MongoFindManyOptions<
  TContract extends MongoContractWithTypeMaps<MongoContract, MongoTypeMaps>,
  ModelName extends string & keyof TContract['models'],
  TInclude extends MongoIncludeSpec<TContract, ModelName> = {},
> {
  readonly where?: MongoWhereFilter<TContract, ModelName>;
  readonly include?: TInclude;
}

// --- Client types ---

export type MongoOrmClient<
  TContract extends MongoContractWithTypeMaps<MongoContract, MongoTypeMaps>,
> = {
  readonly [K in keyof TContract['roots']]: TContract['roots'][K] extends string &
    keyof TContract['models']
    ? MongoCollection<TContract, TContract['roots'][K]>
    : never;
};

export interface MongoCollection<
  TContract extends MongoContractWithTypeMaps<MongoContract, MongoTypeMaps>,
  ModelName extends string & keyof TContract['models'],
> {
  findMany<TInclude extends MongoIncludeSpec<TContract, ModelName> = {}>(
    options?: MongoFindManyOptions<TContract, ModelName, TInclude>,
  ): AsyncIterableResult<
    InferRootRow<TContract, ModelName> & IncludeResultFields<TContract, ModelName, TInclude>
  >;
}
