import type { SqlContract, SqlStorage } from '@prisma-next/sql-contract/types';
import type { SqlQueryPlan } from '@prisma-next/sql-relational-core/plan';
import type { KyselyQueryLane } from '../src/client';

type MockContract = SqlContract<SqlStorage> & {
  storage: {
    tables: {
      user: {
        columns: {
          id: { codecId: 'string'; nullable: false; nativeType: 'uuid' };
          email: { codecId: 'string'; nullable: false; nativeType: 'text' };
          createdAt: { codecId: 'string'; nullable: false; nativeType: 'timestamptz' };
          kind: { codecId: 'string'; nullable: false; nativeType: 'text' };
        };
        uniques: [];
        indexes: [];
        foreignKeys: [];
      };
      post: {
        columns: {
          id: { codecId: 'string'; nullable: false; nativeType: 'uuid' };
          userId: { codecId: 'string'; nullable: false; nativeType: 'uuid' };
          title: { codecId: 'string'; nullable: false; nativeType: 'text' };
          createdAt: { codecId: 'string'; nullable: false; nativeType: 'timestamptz' };
        };
        uniques: [];
        indexes: [];
        foreignKeys: [];
      };
    };
  };
  mappings: {
    codecTypes: {
      string: { output: string };
    };
    operationTypes: Record<string, never>;
  };
};

type HasKey<TObject, TKey extends string> = TKey extends keyof TObject ? true : false;
type AssertFalse<TValue extends false> = TValue;
type AssertTrue<TValue extends true> = TValue;
type IsEqual<TLeft, TRight> =
  (<T>() => T extends TLeft ? 1 : 2) extends <T>() => T extends TRight ? 1 : 2 ? true : false;

declare const lane: KyselyQueryLane<MockContract>;
const query = lane
  .selectFrom('user')
  .select(['id', 'email'])
  .orderBy('createdAt', 'desc')
  .limit(10);
const plan = lane.build(query);
void lane.whereExpr(query);

type BuiltRow = typeof plan extends SqlQueryPlan<infer TRow> ? TRow : never;
type ExpectedRow = { id: string; email: string };

const assertPlanRowInference: AssertTrue<IsEqual<BuiltRow, ExpectedRow>> = true;
const assertNoExecuteOnLane: AssertFalse<HasKey<typeof lane, 'execute'>> = false;
const assertNoTransactionOnLane: AssertFalse<HasKey<typeof lane, 'transaction'>> = false;
void assertPlanRowInference;
void assertNoExecuteOnLane;
void assertNoTransactionOnLane;
