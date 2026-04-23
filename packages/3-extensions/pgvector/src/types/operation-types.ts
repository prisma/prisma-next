import type { SqlQueryOperationTypes } from '@prisma-next/sql-contract/types';
import type { CodecExpression, Expression } from '@prisma-next/sql-relational-core/expression';

type CodecTypesBase = Record<string, { readonly input: unknown; readonly output: unknown }>;

/**
 * Operation type definitions for pgvector extension.
 *
 * This file exports type-only definitions for operation method signatures.
 * These types are imported by contract.d.ts files for compile-time type inference.
 */

export type OperationTypes = {
  readonly 'pg/vector@1': {
    readonly cosineDistance: {
      readonly self: { readonly codecId: 'pg/vector@1' };
    };
    readonly cosineSimilarity: {
      readonly self: { readonly codecId: 'pg/vector@1' };
    };
  };
};

/** Flat operation signatures for the query builder. */
export type QueryOperationTypes<CT extends CodecTypesBase> = SqlQueryOperationTypes<
  CT,
  {
    readonly cosineDistance: {
      readonly self: { readonly codecId: 'pg/vector@1' };
      readonly impl: (
        self: CodecExpression<'pg/vector@1', boolean, CT>,
        other: CodecExpression<'pg/vector@1', boolean, CT>,
      ) => Expression<{ codecId: 'pg/float8@1'; nullable: false }>;
    };
    readonly cosineSimilarity: {
      readonly self: { readonly codecId: 'pg/vector@1' };
      readonly impl: (
        self: CodecExpression<'pg/vector@1', boolean, CT>,
        other: CodecExpression<'pg/vector@1', boolean, CT>,
      ) => Expression<{ codecId: 'pg/float8@1'; nullable: false }>;
    };
  }
>;
