import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import sqliteAdapter from '@prisma-next/adapter-sqlite/runtime';
import type { Contract } from '@prisma-next/contract/types';
import sqliteDriver from '@prisma-next/driver-sqlite/runtime';
import { instantiateExecutionStack } from '@prisma-next/framework-components/execution';
import { sql as sqlBuilder } from '@prisma-next/sql-builder/runtime';
import type { Db } from '@prisma-next/sql-builder/types';
import type { SqlStorage } from '@prisma-next/sql-contract/types';
import { orm } from '@prisma-next/sql-orm-client';
import type { RawCodecInferer } from '@prisma-next/sql-relational-core/expression';
import type { ExecutionContext } from '@prisma-next/sql-relational-core/query-lane-context';
import {
  createExecutionContext,
  createSqlExecutionStack,
  type Runtime,
} from '@prisma-next/sql-runtime';
import { SqliteRuntimeImpl } from '@prisma-next/sqlite/runtime';
import sqliteTarget from '@prisma-next/target-sqlite/runtime';
import { TestSqlContractSerializer as SqlContractSerializer } from '../../../../../packages/2-sql/9-family/test/test-sql-contract-serializer';

export interface SqliteTestContext<TContract extends Contract<SqlStorage>> {
  readonly db: Db<TContract>;
  readonly runtime: Runtime;
  readonly ormClient: ReturnType<typeof orm<TContract>>;
  readonly rawDb: DatabaseSync;
}

export async function withSqliteTestRuntime<TContract extends Contract<SqlStorage>>(
  contractJsonPath: string,
  callback: (ctx: SqliteTestContext<TContract>) => Promise<void>,
): Promise<void> {
  const contractJson = JSON.parse(readFileSync(contractJsonPath, 'utf-8')) as unknown;
  const contract = new SqlContractSerializer().deserializeContract(contractJson) as TContract;

  const testDir = mkdtempSync(join(tmpdir(), 'prisma-sqlite-e2e-'));
  const dbPath = join(testDir, 'test.db');

  const rawDb = new DatabaseSync(dbPath);
  rawDb.exec('PRAGMA foreign_keys = ON');

  try {
    createSchema(rawDb, contract);
    seedData(rawDb);

    const { runtime, context, rawCodecInferer } = await createSqliteRuntime(contract, dbPath);

    try {
      const db = sqlBuilder<TContract>({ context, rawCodecInferer });
      const ormClient = orm({
        context,
        runtime: {
          execute(plan) {
            return runtime.execute(plan);
          },
          connection() {
            return runtime.connection();
          },
        },
      });

      await callback({ db, runtime, ormClient, rawDb });
    } finally {
      await runtime.close();
    }
  } finally {
    rawDb.close();
    try {
      rmSync(testDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  }
}

export function createSchema<TContract extends Contract<SqlStorage>>(
  db: DatabaseSync,
  contract: TContract,
): void {
  db.exec(`
    CREATE TABLE _prisma_marker (
      space TEXT NOT NULL PRIMARY KEY DEFAULT 'app',
      core_hash TEXT NOT NULL,
      profile_hash TEXT NOT NULL,
      contract_json TEXT,
      canonical_version INTEGER,
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      app_tag TEXT,
      meta TEXT NOT NULL DEFAULT '{}',
      invariants TEXT NOT NULL DEFAULT '[]'
    )
  `);
  db.prepare('INSERT INTO _prisma_marker (space, core_hash, profile_hash) VALUES (?, ?, ?)').run(
    'app',
    contract.storage.storageHash,
    contract.profileHash ?? contract.storage.storageHash,
  );

  db.exec(`
    CREATE TABLE users (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT NOT NULL,
      invited_by_id INTEGER
    )
  `);
  db.exec(`
    CREATE TABLE posts (
      id INTEGER PRIMARY KEY,
      title TEXT NOT NULL,
      user_id INTEGER NOT NULL,
      views INTEGER NOT NULL
    )
  `);
  db.exec(`
    CREATE TABLE comments (
      id INTEGER PRIMARY KEY,
      body TEXT NOT NULL,
      post_id INTEGER NOT NULL
    )
  `);
  db.exec(`
    CREATE TABLE profiles (
      id INTEGER PRIMARY KEY,
      user_id INTEGER NOT NULL,
      bio TEXT NOT NULL
    )
  `);
  db.exec(`
    CREATE TABLE typed_rows (
      id INTEGER PRIMARY KEY,
      active INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      metadata TEXT,
      label TEXT NOT NULL
    )
  `);
  db.exec(`
    CREATE TABLE items (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      label TEXT NOT NULL DEFAULT 'unnamed'
    )
  `);
}

export function seedData(db: DatabaseSync): void {
  db.exec(`
    INSERT INTO users (id, name, email, invited_by_id) VALUES
      (1, 'Alice', 'alice@example.com', NULL),
      (2, 'Bob', 'bob@example.com', 1),
      (3, 'Charlie', 'charlie@example.com', 1),
      (4, 'Diana', 'diana@example.com', 2)
  `);
  db.exec(`
    INSERT INTO posts (id, title, user_id, views) VALUES
      (1, 'Hello World', 1, 100),
      (2, 'Second Post', 1, 50),
      (3, 'Bobs Post', 2, 200),
      (4, 'Another One', 3, 10)
  `);
  db.exec(`
    INSERT INTO comments (id, body, post_id) VALUES
      (1, 'Great post!', 1),
      (2, 'Nice work', 1),
      (3, 'Interesting', 3)
  `);
  db.exec(`
    INSERT INTO profiles (id, user_id, bio) VALUES
      (1, 1, 'Alice bio'),
      (2, 2, 'Bob bio')
  `);
}

async function createSqliteRuntime<TContract extends Contract<SqlStorage>>(
  contract: TContract,
  dbPath: string,
): Promise<{
  runtime: Runtime;
  context: ExecutionContext<TContract>;
  rawCodecInferer: RawCodecInferer;
}> {
  const stack = createSqlExecutionStack({
    target: sqliteTarget,
    adapter: sqliteAdapter,
    driver: sqliteDriver,
    extensions: [],
  });

  const stackInstance = instantiateExecutionStack(stack);
  const context = createExecutionContext({ contract, stack });
  const driver = stackInstance.driver!;
  await driver.connect({ kind: 'path', path: dbPath });

  const runtime = new SqliteRuntimeImpl({
    context,
    adapter: stackInstance.adapter,
    driver,
  });

  return { runtime, context, rawCodecInferer: stack.adapter.rawCodecInferer };
}
