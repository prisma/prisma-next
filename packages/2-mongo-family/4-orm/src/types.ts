import type { MongoContract, MongoQueryPlan } from '@prisma-next/mongo-core';
import type { AsyncIterableResult } from '@prisma-next/runtime-executor';

export interface MongoQueryExecutor {
  execute<Row>(plan: MongoQueryPlan<Row>): AsyncIterableResult<Row>;
}

export interface MongoOrmOptions<TContract extends MongoContract> {
  readonly contract: TContract;
  readonly executor: MongoQueryExecutor;
}

export type MongoWhereFilter<
  TContract extends MongoContract,
  ModelName extends string & keyof TContract['models'],
> = {
  readonly [K in keyof TContract['models'][ModelName]['fields']]?: unknown;
};

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

export type MongoIncludeSpec<
  TContract extends MongoContract,
  ModelName extends string & keyof TContract['models'],
> = {
  readonly [K in ReferenceRelationKeys<TContract, ModelName>]?: true;
};

export interface MongoFindManyOptions<
  TContract extends MongoContract,
  ModelName extends string & keyof TContract['models'],
> {
  readonly where?: MongoWhereFilter<TContract, ModelName>;
  readonly include?: MongoIncludeSpec<TContract, ModelName>;
}

export type MongoOrmClient<TContract extends MongoContract> = {
  readonly [K in keyof TContract['roots']]: TContract['roots'][K] extends string &
    keyof TContract['models']
    ? MongoCollection<TContract, TContract['roots'][K]>
    : never;
};

export interface MongoCollection<
  TContract extends MongoContract,
  _ModelName extends string & keyof TContract['models'],
> {
  findMany(options?: MongoFindManyOptions<TContract, _ModelName>): AsyncIterableResult<unknown>;
}
