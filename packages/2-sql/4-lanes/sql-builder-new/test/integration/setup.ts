import postgresAdapter from '@prisma-next/adapter-postgres/runtime';
import { instantiateExecutionStack } from '@prisma-next/core-execution-plane/stack';
import postgresDriver from '@prisma-next/driver-postgres/runtime';
import pgvector from '@prisma-next/extension-pgvector/runtime';
import { validateContract } from '@prisma-next/sql-contract/validate';
import type { ExecutionContext } from '@prisma-next/sql-relational-core/query-lane-context';
import {
  createExecutionContext,
  createRuntime,
  createSqlExecutionStack,
  type Runtime,
} from '@prisma-next/sql-runtime';
import { setupTestDatabase } from '@prisma-next/sql-runtime/test/utils';
import postgresTarget from '@prisma-next/target-postgres/runtime';
import { createDevDatabase, timeouts } from '@prisma-next/test-utils';
import { Client } from 'pg';
import { afterAll, beforeAll } from 'vitest';
import { createDb } from '../../src/runtime/create-db';
import { contract } from '../fixtures/contract';
import type { Contract } from '../fixtures/generated/contract';

export { timeouts };

const sqlContract = validateContract<Contract>(contract);

export async function collect<T>(iter: AsyncIterable<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const item of iter) out.push(item);
  return out;
}

export function setupIntegrationTest() {
  let runtime: Runtime;
  let context: ExecutionContext<typeof sqlContract>;
  const closeFns: Array<() => Promise<void>> = [];

  beforeAll(async () => {
    const database = await createDevDatabase();
    const client = new Client({ connectionString: database.connectionString });
    await client.connect();

    await setupTestDatabase(client, sqlContract, async (c) => {
      await c.query(`
        CREATE TABLE users (
          id int4 PRIMARY KEY,
          name text NOT NULL,
          email text NOT NULL,
          invited_by_id int4
        )
      `);
      await c.query('CREATE EXTENSION IF NOT EXISTS vector');
      await c.query(`
        CREATE TABLE posts (
          id int4 PRIMARY KEY,
          title text NOT NULL,
          user_id int4 NOT NULL,
          views int4 NOT NULL,
          embedding vector(3)
        )
      `);
      await c.query(`
        CREATE TABLE comments (
          id int4 PRIMARY KEY,
          body text NOT NULL,
          post_id int4 NOT NULL
        )
      `);
      await c.query(`
        CREATE TABLE profiles (
          id int4 PRIMARY KEY,
          user_id int4 NOT NULL,
          bio text NOT NULL
        )
      `);

      await c.query(`
        INSERT INTO users (id, name, email, invited_by_id) VALUES
          (1, 'Alice', 'alice@example.com', NULL),
          (2, 'Bob', 'bob@example.com', 1),
          (3, 'Charlie', 'charlie@example.com', 1),
          (4, 'Diana', 'diana@example.com', 2)
      `);
      await c.query(`
        INSERT INTO posts (id, title, user_id, views, embedding) VALUES
          (1, 'Hello World', 1, 100, '[1,0,0]'),
          (2, 'Second Post', 1, 50, '[0,1,0]'),
          (3, 'Bobs Post', 2, 200, '[0,0,1]'),
          (4, 'Another One', 3, 10, '[1,1,0]')
      `);
      await c.query(`
        INSERT INTO comments (id, body, post_id) VALUES
          (1, 'Great post!', 1),
          (2, 'Nice work', 1),
          (3, 'Interesting', 3)
      `);
      await c.query(`
        INSERT INTO profiles (id, user_id, bio) VALUES
          (1, 1, 'Alice bio'),
          (2, 2, 'Bob bio')
      `);
    });

    const stack = createSqlExecutionStack({
      target: postgresTarget,
      adapter: postgresAdapter,
      driver: {
        ...postgresDriver,
        create() {
          return postgresDriver.create({ cursor: { disabled: true } });
        },
      },
      extensionPacks: [pgvector],
    });

    const stackInstance = instantiateExecutionStack(stack);
    context = createExecutionContext({ contract: sqlContract, stack });
    const driver = stackInstance.driver!;
    await driver.connect({ kind: 'pgClient', client });

    runtime = createRuntime({
      stackInstance,
      context,
      driver,
      verify: { mode: 'onFirstUse', requireMarker: false },
    });

    closeFns.push(
      () => runtime.close(),
      () => client.end(),
      () => database.close(),
    );
  }, timeouts.spinUpPpgDev);

  afterAll(async () => {
    for (const fn of closeFns) {
      try {
        await fn();
      } catch {
        // ignore cleanup errors
      }
    }
  });

  function db() {
    return createDb({ context, runtime });
  }

  return { db };
}
