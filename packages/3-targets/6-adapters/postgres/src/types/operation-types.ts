import type { SqlQueryOperationTypes } from '@prisma-next/sql-contract/types';
import type {
  CodecExpression,
  Expression,
  TraitExpression,
} from '@prisma-next/sql-relational-core/expression';

type CodecTypesBase = Record<string, { readonly input: unknown; readonly output: unknown }>;

export type QueryOperationTypes<CT extends CodecTypesBase> = SqlQueryOperationTypes<
  CT,
  {
    readonly ilike: {
      readonly self: { readonly traits: readonly ['textual'] };
      readonly impl: (
        self: TraitExpression<readonly ['textual'], false, CT>,
        pattern: CodecExpression<'pg/text@1', false, CT>,
      ) => Expression<{ codecId: 'pg/bool@1'; nullable: false }>;
    };
  }
>;
