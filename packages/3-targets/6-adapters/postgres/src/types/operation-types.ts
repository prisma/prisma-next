import type { SqlQueryOperationTypes } from '@prisma-next/sql-contract/types';

export type QueryOperationTypes = SqlQueryOperationTypes<{
  readonly ilike: {
    readonly args: readonly [
      { readonly traits: 'textual'; readonly nullable: boolean },
      { readonly codecId: 'pg/text@1'; readonly nullable: false },
    ];
    readonly returns: { readonly codecId: 'pg/bool@1'; readonly nullable: false };
  };
}>;
