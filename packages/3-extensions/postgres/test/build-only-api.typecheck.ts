import type { SqlContract, SqlStorage } from '@prisma-next/sql-contract/types';
import type { CompiledQuery, KyselyQueryLane } from '@prisma-next/sql-kysely-lane';
import type { SqlQueryPlan } from '@prisma-next/sql-relational-core/plan';
import postgres from '../src/runtime/postgres';

const contract: SqlContract<SqlStorage> = {
  schemaVersion: '1',
  targetFamily: 'sql',
  target: 'postgres',
  storageHash: 'sha256:test' as never,
  models: {},
  relations: {},
  storage: { tables: {} },
  extensionPacks: {},
  capabilities: {},
  meta: {},
  sources: {},
  mappings: {
    codecTypes: {},
    operationTypes: {},
  },
};

const db = postgres({
  contract,
  url: 'postgres://localhost:5432/db',
});
const lane: KyselyQueryLane<typeof contract> = db.kysely;
void lane;

const query = db.kysely.selectFrom('user').selectAll();
db.kysely.build(query);

const queryWithCompiledRow = {
  compile(): CompiledQuery<{ id: string; kind: 'admin' | 'user' }> {
    return {} as CompiledQuery<{ id: string; kind: 'admin' | 'user' }>;
  },
};

const plan = db.kysely.build(queryWithCompiledRow);
const typedPlan: SqlQueryPlan<{ id: string; kind: 'admin' | 'user' }> = plan;
void typedPlan;

db.kysely.whereExpr(query);

type HasKey<TObject, TKey extends string> = TKey extends keyof TObject ? true : false;
type AssertFalse<TValue extends false> = TValue;

type KyselyLaneHasExecute = HasKey<typeof db.kysely, 'execute'>;
type KyselyLaneHasTransaction = HasKey<typeof db.kysely, 'transaction'>;

const assertNoExecuteOnLane: AssertFalse<KyselyLaneHasExecute> = false;
const assertNoTransactionOnLane: AssertFalse<KyselyLaneHasTransaction> = false;
void assertNoExecuteOnLane;
void assertNoTransactionOnLane;
