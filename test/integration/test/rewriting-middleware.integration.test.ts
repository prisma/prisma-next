import postgresAdapter from '@prisma-next/adapter-postgres/runtime';
import postgresDriver from '@prisma-next/driver-postgres/runtime';
import pgvector from '@prisma-next/extension-pgvector/runtime';
import { emptyCodecLookup } from '@prisma-next/framework-components/codec';
import { instantiateExecutionStack } from '@prisma-next/framework-components/execution';
import { sql } from '@prisma-next/sql-builder/runtime';
import { validateContract } from '@prisma-next/sql-contract/validate';
import {
  AndExpr,
  BinaryExpr,
  ColumnRef,
  ParamRef,
  type SelectAst,
} from '@prisma-next/sql-relational-core/ast';
import type { ExecutionContext } from '@prisma-next/sql-relational-core/query-lane-context';
import {
  createExecutionContext,
  createRuntime,
  createSqlExecutionStack,
  type Runtime,
  type SqlMiddleware,
} from '@prisma-next/sql-runtime';
import { setupTestDatabase } from '@prisma-next/sql-runtime/test/utils';
import postgresTarget from '@prisma-next/target-postgres/runtime';
import { createDevDatabase, timeouts } from '@prisma-next/test-utils';
import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { contract } from './sql-builder/fixtures/contract';
import type { Contract } from './sql-builder/fixtures/generated/contract';

const sqlContract = validateContract<Contract>(contract, emptyCodecLookup);

function rewriteUserSelects(predicate: (ast: SelectAst) => SelectAst): SqlMiddleware {
  return {
    name: 'rewriteUserSelects',
    familyId: 'sql',
    async beforeCompile(draft) {
      if (draft.ast.kind !== 'select') return undefined;
      if (draft.ast.from.kind !== 'table-source') return undefined;
      if (draft.ast.from.name !== 'users') return undefined;
      return { ...draft, ast: predicate(draft.ast) };
    },
  };
}

describe('integration: SQL middleware rewriting', { timeout: timeouts.databaseOperation }, () => {
  let runtime: Runtime;
  let context: ExecutionContext<typeof sqlContract>;
  let debug: ReturnType<typeof vi.fn<(event: unknown) => void>>;
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
        CREATE TABLE articles (
          id uuid PRIMARY KEY,
          title text NOT NULL
        )
      `);

      await c.query(`
        INSERT INTO users (id, name, email, invited_by_id) VALUES
          (1, 'Alice', 'alice@example.com', NULL),
          (2, 'Bob',   'bob@example.com',   1),
          (3, 'Charlie','charlie@example.com', 1),
          (4, 'Diana', 'diana@example.com',  2)
      `);
    });

    // Middleware filters SELECT * FROM users to just id=1 (Alice). Demonstrates
    // that a rewrite composes with any user-supplied WHERE, and that parameterized
    // predicates flow through the adapter's lowering path.
    const idEqOne = BinaryExpr.eq(
      ColumnRef.of('users', 'id'),
      ParamRef.of(1, { name: 'middleware_user_id', codecId: 'pg/int4@1' }),
    );

    const onlyAlice = rewriteUserSelects((ast) => {
      const combined = ast.where ? AndExpr.of([ast.where, idEqOne]) : idEqOne;
      return ast.withWhere(combined);
    });

    debug = vi.fn<(event: unknown) => void>();

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
    const driver = stackInstance.driver;
    if (!driver) throw new Error('Driver missing');
    await driver.connect({ kind: 'pgClient', client });

    runtime = createRuntime({
      stackInstance,
      context,
      driver,
      verify: { mode: 'onFirstUse', requireMarker: false },
      middleware: [onlyAlice],
      log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug },
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

  it('rewrites a SELECT to filter by the middleware-added predicate', async () => {
    const db = sql({ context });
    const rows = await runtime.execute(db.users.select('id', 'name').build()).toArray();
    const ids = rows.map((r) => r.id).sort();

    expect(ids).toEqual([1]);
    expect(debug).toHaveBeenCalledWith({
      event: 'middleware.rewrite',
      middleware: 'rewriteUserSelects',
      lane: 'dsl',
    });
  });

  it('composes with a user-supplied WHERE clause', async () => {
    const db = sql({ context });
    // User filters gt(id, 2); middleware adds id == 1; AND of both is empty.
    const rows = await runtime
      .execute(
        db.users
          .select('id')
          .where((f, fns) => fns.gt(f.id, 2))
          .build(),
      )
      .toArray();

    expect(rows).toEqual([]);
  });
});
