import type { SqlQueryOperationTypes } from '@prisma-next/sql-contract/types';
import type {
  CodecExpression,
  CodecValue,
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
    readonly arrayContains: {
      readonly self: { readonly many: true; readonly elementTraits: readonly ['equality'] };
      readonly impl: <CodecId extends keyof CT & string>(
        self: ScalarListExpression<CodecId, false>,
        other: readonly CodecValue<CodecId, false, CT>[] | ScalarListExpression<CodecId, false>,
      ) => Expression<{ codecId: 'pg/bool@1'; nullable: false }>;
    };
    readonly containedBy: {
      readonly self: { readonly many: true; readonly elementTraits: readonly ['equality'] };
      readonly impl: <CodecId extends keyof CT & string>(
        self: ScalarListExpression<CodecId, false>,
        other: readonly CodecValue<CodecId, false, CT>[] | ScalarListExpression<CodecId, false>,
      ) => Expression<{ codecId: 'pg/bool@1'; nullable: false }>;
    };
    readonly overlaps: {
      readonly self: { readonly many: true; readonly elementTraits: readonly ['equality'] };
      readonly impl: <CodecId extends keyof CT & string>(
        self: ScalarListExpression<CodecId, false>,
        other: readonly CodecValue<CodecId, false, CT>[] | ScalarListExpression<CodecId, false>,
      ) => Expression<{ codecId: 'pg/bool@1'; nullable: false }>;
    };
    readonly length: {
      readonly self: { readonly many: true };
      readonly impl: <CodecId extends keyof CT & string>(
        self: ScalarListExpression<CodecId, false>,
      ) => Expression<{ codecId: 'pg/int4@1'; nullable: false }>;
    };
    readonly index: {
      readonly self: { readonly many: true };
      readonly impl: <CodecId extends keyof CT & string>(
        self: ScalarListExpression<CodecId, false>,
        i: CodecExpression<'pg/int4@1', false, CT>,
      ) => Expression<{ codecId: CodecId; nullable: true }>;
    };
  }
>;
