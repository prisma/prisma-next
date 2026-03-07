import type {
  ContractWithTypeMaps,
  SqlContract,
  SqlStorage,
  TypeMaps,
} from '@prisma-next/sql-contract/types';
import type { SqlQueryPlan } from '@prisma-next/sql-relational-core/plan';
import type { KyselyQueryLane } from '../src/client';

type MockCodecTypes = {
  string: { output: string };
};

type MockContract = ContractWithTypeMaps<
  SqlContract<SqlStorage> & {
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
  },
  TypeMaps<MockCodecTypes, Record<string, never>>
>;

type HasKey<TObject, TKey extends string> = TKey extends keyof TObject ? true : false;
type AssertFalse<TValue extends false> = TValue;
type AssertTrue<TValue extends true> = TValue;

declare const lane: KyselyQueryLane<MockContract>;
const query = lane
  .selectFrom('user')
  .select(['id', 'email'])
  .orderBy('createdAt', 'desc')
  .limit(10);
const plan = lane.build(query);
void lane.whereExpr(query);

type BuiltRow = typeof plan extends SqlQueryPlan<infer TRow> ? TRow : never;
type BuiltId = BuiltRow extends { id: infer TValue } ? TValue : never;
type BuiltEmail = BuiltRow extends { email: infer TValue } ? TValue : never;
type BuiltIdIsString = BuiltId extends string ? true : false;
type BuiltEmailIsString = BuiltEmail extends string ? true : false;

const assertPlanRowInference: AssertTrue<BuiltIdIsString> = true;
const assertEmailInference: AssertTrue<BuiltEmailIsString> = true;
const assertNoExecuteOnLane: AssertFalse<HasKey<typeof lane, 'execute'>> = false;
const assertNoTransactionOnLane: AssertFalse<HasKey<typeof lane, 'transaction'>> = false;
const assertNoExecuteOnQuery: AssertFalse<HasKey<typeof query, 'execute'>> = false;
const assertNoStreamOnQuery: AssertFalse<HasKey<typeof query, 'stream'>> = false;
void assertPlanRowInference;
void assertEmailInference;
void assertNoExecuteOnLane;
void assertNoTransactionOnLane;
void assertNoExecuteOnQuery;
void assertNoStreamOnQuery;
