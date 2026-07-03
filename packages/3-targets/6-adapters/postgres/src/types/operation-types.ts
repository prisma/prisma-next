import type { SqlQueryOperationTypes } from '@prisma-next/sql-contract/types';
import type {
  CodecExpression,
  Expression,
  ScalarListExpression,
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
    readonly has: {
      readonly self: { readonly many: true; readonly elementTraits: readonly ['equality'] };
      readonly impl: <CodecId extends keyof CT & string>(
        self: ScalarListExpression<CodecId, false>,
        elem: CodecExpression<CodecId, false, CT>,
      ) => Expression<{ codecId: 'pg/bool@1'; nullable: false }>;
    };
  }
>;
