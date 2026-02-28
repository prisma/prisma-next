import type { SqlContract, SqlStorage } from '@prisma-next/sql-contract/types';
import type { SqlQueryPlan } from '@prisma-next/sql-relational-core/plan';
import type { CompiledQuery } from 'kysely';
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

query.execute();
db.kysely.transaction();
