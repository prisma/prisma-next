import type { MongoContract } from '@prisma-next/mongo-contract';
import type {
  MongoAggAccumulator,
  MongoAggExpr,
  MongoFilterExpr,
} from '@prisma-next/mongo-query-ast';
import type { MongoValue } from '@prisma-next/mongo-value';

export interface DocField {
  readonly codecId: string;
  readonly nullable: boolean;
}

export type NumericField = { readonly codecId: 'mongo/double@1'; readonly nullable: false };
export type NullableNumericField = { readonly codecId: 'mongo/double@1'; readonly nullable: true };
export type StringField = { readonly codecId: 'mongo/string@1'; readonly nullable: false };
export type ArrayField = { readonly codecId: 'mongo/array@1'; readonly nullable: false };
export type BooleanField = { readonly codecId: 'mongo/bool@1'; readonly nullable: false };
export type DateField = { readonly codecId: 'mongo/date@1'; readonly nullable: false };
export type NullableDocField = { readonly codecId: string; readonly nullable: true };

export type LiteralValue<F extends DocField> = F extends StringField
  ? string
  : F extends NumericField
    ? number
    : F extends BooleanField
      ? boolean
      : F extends DateField
        ? Date
        : unknown;

export type DocShape = Record<string, DocField>;

type ExtractCodecId<F> = F extends { type: { kind: 'scalar'; codecId: infer C } } ? C : string;

export type ModelToDocShape<
  TContract extends MongoContract,
  ModelName extends string & keyof TContract['models'],
> = {
  [K in keyof TContract['models'][ModelName]['fields'] & string]: {
    readonly codecId: ExtractCodecId<TContract['models'][ModelName]['fields'][K]>;
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

export interface TypedAccumulatorExpr<F extends DocField> {
  readonly _field: F;
  readonly node: MongoAggAccumulator;
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
} & ('_id' extends keyof Shape
  ? '_id' extends keyof Spec
    ? Record<keyof never, never>
    : Pick<Shape, '_id'>
  : Record<keyof never, never>);

export type GroupSpec = {
  _id: TypedAggExpr<DocField> | null;
  [key: string]: TypedAggExpr<DocField> | TypedAccumulatorExpr<DocField> | null;
};

export type GroupedDocShape<Spec extends GroupSpec> = {
  [K in keyof Spec & string]: Spec[K] extends TypedAggExpr<infer F>
    ? F
    : Spec[K] extends null
      ? { readonly codecId: 'mongo/null@1'; readonly nullable: true }
      : DocField;
};

/**
 * Intentionally identity — full array element type extraction is deferred.
 * Used by `UnwoundShape` so the unwind result shape can be refined later
 * without changing the public API.
 */
type UnwrapArrayDocField<F extends DocField> = F;

export type UnwoundShape<S extends DocShape, K extends keyof S & string> = {
  [P in keyof S & string]: P extends K ? UnwrapArrayDocField<S[P]> : S[P];
};
