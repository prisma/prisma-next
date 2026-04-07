import type {
  ExtractMongoCodecTypes,
  MongoContract,
  MongoContractWithTypeMaps,
  MongoTypeMaps,
} from '@prisma-next/mongo-contract';
import type { MongoAggExpr, MongoFilterExpr } from '@prisma-next/mongo-query-ast';
import type { MongoValue } from '@prisma-next/mongo-value';

export interface DocField {
  readonly codecId: string;
  readonly nullable: boolean;
}

export type DocShape = Record<string, DocField>;

export type ModelToDocShape<
  TContract extends MongoContract,
  ModelName extends string & keyof TContract['models'],
> = {
  [K in keyof TContract['models'][ModelName]['fields'] & string]: {
    readonly codecId: TContract['models'][ModelName]['fields'][K]['codecId'];
    readonly nullable: TContract['models'][ModelName]['fields'][K]['nullable'];
  };
};

export type ResolveRow<
  Shape extends DocShape,
  CodecTypes extends Record<string, { readonly output: unknown }>,
> = {
  -readonly [K in keyof Shape & string]: Shape[K]['codecId'] extends keyof CodecTypes
    ? Shape[K]['nullable'] extends true
      ? CodecTypes[Shape[K]['codecId']]['output'] | null
      : CodecTypes[Shape[K]['codecId']]['output']
    : unknown;
};

export interface TypedAggExpr<F extends DocField> {
  readonly _field: F;
  readonly node: MongoAggExpr;
}

export type ExtractDocShape<T extends Record<string, TypedAggExpr<DocField>>> = {
  [K in keyof T & string]: T[K]['_field'];
};

export type SortSpec<S extends DocShape> = Partial<Record<keyof S & string, 1 | -1>>;

export type FieldProxy<S extends DocShape> = {
  readonly [K in keyof S & string]: TypedAggExpr<S[K]>;
};

export type FilterHandle = {
  eq(value: MongoValue): MongoFilterExpr;
  ne(value: MongoValue): MongoFilterExpr;
  gt(value: MongoValue): MongoFilterExpr;
  gte(value: MongoValue): MongoFilterExpr;
  lt(value: MongoValue): MongoFilterExpr;
  lte(value: MongoValue): MongoFilterExpr;
  in(values: ReadonlyArray<MongoValue>): MongoFilterExpr;
  exists(flag?: boolean): MongoFilterExpr;
};

export type FilterProxy<S extends DocShape> = {
  readonly [K in keyof S & string]: FilterHandle;
};

export type ProjectedShape<
  Shape extends DocShape,
  Spec extends Record<string, 1 | TypedAggExpr<DocField>>,
> = {
  [K in keyof Spec & string]: Spec[K] extends 1
    ? K extends keyof Shape
      ? Shape[K]
      : DocField
    : Spec[K] extends TypedAggExpr<infer F>
      ? F
      : DocField;
};

export type GroupSpec = {
  _id: TypedAggExpr<DocField> | null;
  [key: string]: TypedAggExpr<DocField> | null;
};

export type GroupedDocShape<Spec extends GroupSpec> = {
  [K in keyof Spec & string]: Spec[K] extends TypedAggExpr<infer F> ? F : DocField;
};

export type UnwrapArrayDocField<F extends DocField> = F;

export type UnwoundShape<S extends DocShape, K extends keyof S & string> = {
  [P in keyof S & string]: P extends K ? UnwrapArrayDocField<S[P]> : S[P];
};

export type RootModelName<TContract extends MongoContract> = {
  [K in keyof TContract['roots'] & string]: TContract['roots'][K] extends string &
    keyof TContract['models']
    ? K
    : never;
}[keyof TContract['roots'] & string];

export type ResolveRowFromContract<
  Shape extends DocShape,
  TContract extends MongoContractWithTypeMaps<MongoContract, MongoTypeMaps>,
> = ResolveRow<Shape, ExtractMongoCodecTypes<TContract>>;
