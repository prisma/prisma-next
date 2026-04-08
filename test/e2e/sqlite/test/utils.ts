import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import sqliteAdapter from '@prisma-next/adapter-sqlite/runtime';
import type { Contract } from '@prisma-next/contract/types';
import sqliteDriver from '@prisma-next/driver-sqlite/runtime';
import { emptyCodecLookup } from '@prisma-next/framework-components/codec';
import { instantiateExecutionStack } from '@prisma-next/framework-components/execution';
import { sql as sqlBuilder } from '@prisma-next/sql-builder/runtime';
import type { Db } from '@prisma-next/sql-builder/types';
import type { SqlStorage } from '@prisma-next/sql-contract/types';
import { validateContract } from '@prisma-next/sql-contract/validate';
import { orm } from '@prisma-next/sql-orm-client';
import type { ExecutionContext } from '@prisma-next/sql-relational-core/query-lane-context';
import {
  createExecutionContext,
  createRuntime,
  createSqlExecutionStack,
  type Runtime,
} from '@prisma-next/sql-runtime';
import sqliteTarget from '@prisma-next/target-sqlite/runtime';

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
  const contract = validateContract<TContract>(contractJson, emptyCodecLookup);

  const testDir = mkdtempSync(join(tmpdir(), 'prisma-sqlite-e2e-'));
  const dbPath = join(testDir, 'test.db');

  const rawDb = new DatabaseSync(dbPath);
  rawDb.exec('PRAGMA foreign_keys = ON');

  try {
    createSchema(rawDb, contract);
    seedData(rawDb);

    const { runtime, context } = await createSqliteRuntime(contract, dbPath);

    try {
      const db: Db<TContract> = sqlBuilder<TContract>({ context });
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

function createSchema<TContract extends Contract<SqlStorage>>(
  db: DatabaseSync,
  contract: TContract,
): void {
  db.exec(`
    CREATE TABLE prisma_contract_marker (
      id INTEGER PRIMARY KEY,
      core_hash TEXT NOT NULL,
      profile_hash TEXT NOT NULL,
      contract_json TEXT,
      canonical_version INTEGER,
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      app_tag TEXT,
      meta TEXT NOT NULL DEFAULT '{}'
    )
  `);
  db.exec(`
    INSERT INTO prisma_contract_marker (id, core_hash, profile_hash)
    VALUES (1, '${contract.storage.storageHash}', '${contract.profileHash ?? contract.storage.storageHash}')
  `);

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

function seedData(db: DatabaseSync): void {
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
): Promise<{ runtime: Runtime; context: ExecutionContext<TContract> }> {
  const stack = createSqlExecutionStack({
    target: sqliteTarget,
    adapter: sqliteAdapter,
    driver: sqliteDriver,
    extensionPacks: [],
  });

  const stackInstance = instantiateExecutionStack(stack);
  const context = createExecutionContext({ contract, stack });
  const driver = stackInstance.driver!;
  await driver.connect({ kind: 'path', path: dbPath });

  const runtime = createRuntime({
    stackInstance,
    context,
    driver,
    verify: { mode: 'onFirstUse', requireMarker: false },
  });

  return { runtime, context };
}
