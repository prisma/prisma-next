import type { ContractReferenceRelation } from '@prisma-next/contract/types';
import type {
  ExtractMongoCodecTypes,
  InferModelRow,
  MongoContract,
  MongoContractWithTypeMaps,
  MongoTypeMaps,
} from '@prisma-next/mongo-core';

type Simplify<T> = T extends unknown ? { [K in keyof T]: T[K] } : never;

export type SimplifyDeep<T> = T extends readonly (infer E)[]
  ? SimplifyDeep<E>[]
  : T extends Date | RegExp | Function
    ? T
    : T extends object
      ? T extends unknown
        ? { [K in keyof T]: SimplifyDeep<T[K]> }
        : never
      : T;

type ModelRelations<
  TContract extends MongoContract,
  ModelName extends string & keyof TContract['models'],
> = NonNullable<TContract['models'][ModelName]['relations']>;

export type ReferenceRelationKeys<
  TContract extends MongoContract,
  ModelName extends string & keyof TContract['models'],
> = {
  [K in keyof ModelRelations<TContract, ModelName>]: ModelRelations<
    TContract,
    ModelName
  >[K] extends ContractReferenceRelation
    ? K
    : never;
}[keyof ModelRelations<TContract, ModelName>];

export type EmbedRelationKeys<
  TContract extends MongoContract,
  ModelName extends string & keyof TContract['models'],
> = {
  [K in keyof ModelRelations<TContract, ModelName>]: ModelRelations<
    TContract,
    ModelName
  >[K] extends ContractReferenceRelation
    ? never
    : K;
}[keyof ModelRelations<TContract, ModelName>];

type EmbedRelationRowType<
  TContract extends MongoContractWithTypeMaps<MongoContract, MongoTypeMaps>,
  ModelName extends string & keyof TContract['models'],
  RelKey extends keyof ModelRelations<TContract, ModelName>,
> = ModelRelations<TContract, ModelName>[RelKey] extends {
  readonly to: infer To extends string & keyof TContract['models'];
  readonly cardinality: infer C;
}
  ? ModelRelations<TContract, ModelName>[RelKey] extends ContractReferenceRelation
    ? never
    : C extends '1:N'
      ? InferModelRow<TContract, To>[]
      : InferModelRow<TContract, To>
  : never;

export type InferFullRow<
  TContract extends MongoContractWithTypeMaps<MongoContract, MongoTypeMaps>,
  ModelName extends string & keyof TContract['models'],
> = EmbedRelationKeys<TContract, ModelName> extends never
  ? InferModelRow<TContract, ModelName>
  : InferModelRow<TContract, ModelName> & {
      -readonly [K in EmbedRelationKeys<TContract, ModelName> &
        keyof ModelRelations<TContract, ModelName>]: EmbedRelationRowType<TContract, ModelName, K>;
    };

type VariantRow<
  TContract extends MongoContractWithTypeMaps<MongoContract, MongoTypeMaps>,
  ModelName extends string & keyof TContract['models'],
> = TContract['models'][ModelName] extends {
  readonly discriminator: { readonly field: infer DiscField extends string };
  readonly variants: infer V;
}
  ? V extends Record<string, { readonly value: string }>
    ? {
        [VK in keyof V]: VK extends string & keyof TContract['models']
          ? Simplify<
              Omit<InferFullRow<TContract, ModelName>, DiscField> &
                InferFullRow<TContract, VK> &
                Record<DiscField, V[VK]['value']>
            >
          : never;
      }[keyof V]
    : InferFullRow<TContract, ModelName>
  : InferFullRow<TContract, ModelName>;

export type InferRootRow<
  TContract extends MongoContractWithTypeMaps<MongoContract, MongoTypeMaps>,
  ModelName extends string & keyof TContract['models'],
> = VariantRow<TContract, ModelName>;

type IncludeRelationRowType<
  TContract extends MongoContractWithTypeMaps<MongoContract, MongoTypeMaps>,
  ModelName extends string & keyof TContract['models'],
  RelKey extends keyof ModelRelations<TContract, ModelName>,
> = ModelRelations<TContract, ModelName>[RelKey] extends ContractReferenceRelation
  ? ModelRelations<TContract, ModelName>[RelKey] extends {
      readonly to: infer To extends string & keyof TContract['models'];
      readonly cardinality: infer C;
    }
    ? C extends 'N:1' | '1:1'
      ? InferFullRow<TContract, To> | null
      : InferFullRow<TContract, To>[]
    : never
  : never;

export type IncludeResultFields<
  TContract extends MongoContractWithTypeMaps<MongoContract, MongoTypeMaps>,
  ModelName extends string & keyof TContract['models'],
  TInclude extends MongoIncludeSpec<TContract, ModelName>,
> = {
  -readonly [K in keyof TInclude & string as TInclude[K] extends true
    ? K
    : never]: K extends keyof ModelRelations<TContract, ModelName>
    ? IncludeRelationRowType<TContract, ModelName, K>
    : never;
};

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

export type NoIncludes = Pick<Record<string, boolean>, never>;

export type IncludedRow<
  TContract extends MongoContractWithTypeMaps<MongoContract, MongoTypeMaps>,
  ModelName extends string & keyof TContract['models'],
  TIncludes extends MongoIncludeSpec<TContract, ModelName> = NoIncludes,
> = InferRootRow<TContract, ModelName> & IncludeResultFields<TContract, ModelName, TIncludes>;
