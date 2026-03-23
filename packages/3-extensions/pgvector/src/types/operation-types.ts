import type { SqlQueryOperationTypes } from '@prisma-next/sql-contract/types';

/**
 * Operation type definitions for pgvector extension.
 *
 * This file exports type-only definitions for operation method signatures.
 * These types are imported by contract.d.ts files for compile-time type inference.
 */

/**
 * Operation types for pgvector extension.
 * Maps typeId to operation methods.
 */
export type OperationTypes = {
  readonly 'pg/vector@1': {
    readonly cosineDistance: {
      readonly args: readonly [
        {
          readonly kind: 'param';
        },
      ];
      readonly returns: {
        readonly kind: 'builtin';
        readonly type: 'number';
      };
      readonly lowering: {
        readonly targetFamily: 'sql';
        readonly strategy: 'function';
        readonly template: string;
      };
    };
  };
};

/** Flat operation signatures for the query builder. */
export type QueryOperationTypes = SqlQueryOperationTypes<{
  readonly cosineDistance: {
    readonly args: readonly [
      { readonly codecId: 'pg/vector@1'; readonly nullable: boolean },
      { readonly codecId: 'pg/vector@1'; readonly nullable: boolean },
    ];
    readonly returns: { readonly codecId: 'pg/float8@1'; readonly nullable: false };
  };
}>;
