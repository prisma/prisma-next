import type { SqlContract, SqlStorage } from '@prisma-next/sql-contract/types';
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

// @ts-expect-error build-only surface does not expose execute on query builders
query.execute();

// @ts-expect-error build-only surface does not expose transaction on root
db.kysely.transaction();
