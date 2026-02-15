/**
 * CLI Application Entry Point (Emitted Contract Workflow)
 *
 * This is a command-line demo application that showcases Prisma Next's query
 * capabilities using the standard emitted contract workflow:
 * - contract.json (runtime contract data)
 * - contract.d.ts (compile-time types)
 *
 * Run with: pnpm start -- <command> [args]
 *
 * Available commands:
 * - users [limit]              List users with optional limit
 * - user <id>                  Get user by ID
 * - posts <userId>             Get posts for a user
 * - users-with-posts [limit]   Users with nested posts (includeMany)
 * - users-paginate [cursor]    Cursor-based pagination
 * - similarity-search <vec>    Vector similarity search (pgvector)
 * - budget-violation           Demo budget enforcement error
 * - user-kysely <id>           Get user by ID (Kysely lane)
 * - posts-kysely <userId>      Get posts for user (Kysely lane)
 * - users-kysely [limit]       List users with limit (Kysely lane)
 * - users-with-posts-kysely    Users with nested posts (Kysely lane)
 * - user-transaction-kysely    Insert user with rollback demo (Kysely lane)
 * - dml-kysely <op> <args>     Insert/update/delete with returning (Kysely lane)
 * - guardrail-delete-kysely    Demo AST lint blocking DELETE without WHERE
 *
 * See also:
 * - main-no-emit.ts: Same CLI using inline contract (no emission step)
 * - entry.ts: Browser app for visualizing contract.json
 */
import 'dotenv/config';
import { type as arktype } from 'arktype';
import { deleteWithoutWhere } from './kysely/delete-without-where';
import {
  deleteUser as deleteUserKysely,
  insertUser as insertUserKysely,
  updateUser as updateUserKysely,
} from './kysely/dml-operations';
import { getAllPostsUnbounded as getAllPostsUnboundedKysely } from './kysely/get-all-posts-unbounded';
import { getUserById as getUserByIdKysely } from './kysely/get-user-by-id';
import { getUserPosts as getUserPostsKysely } from './kysely/get-user-posts';
import { getUsers as getUsersKysely } from './kysely/get-users';
import { getUsersWithPosts as getUsersWithPostsKysely } from './kysely/get-users-with-posts';
import { insertUserTransaction as insertUserTransactionKysely } from './kysely/insert-user-transaction';
import { db } from './prisma/db';
import { getAllPostsUnbounded } from './queries/get-all-posts-unbounded';
import { getUserById } from './queries/get-user-by-id';
import { getUserPosts } from './queries/get-user-posts';
import { getUsers } from './queries/get-users';
import { getUsersWithPosts } from './queries/get-users-with-posts';
import { ormGetUsersBackward, ormGetUsersByIdCursor } from './queries/orm-pagination';
import { similaritySearch } from './queries/similarity-search';

const appConfigSchema = arktype({
  DATABASE_URL: 'string',
});

export function loadAppConfig() {
  const result = appConfigSchema({
    DATABASE_URL: process.env['DATABASE_URL'],
  });
  if (result instanceof arktype.errors) {
    const message = result.map((p: { message: string }) => p.message).join('; ');
    throw new Error(`Invalid app configuration: ${message}`);
  }
  const parsed = result as { DATABASE_URL: string };
  return { databaseUrl: parsed.DATABASE_URL };
}

const argv = process.argv.slice(2).filter((arg) => arg !== '--');
const [cmd, ...args] = argv;

async function main() {
  loadAppConfig();
  const runtime = db.runtime();
  try {
    if (cmd === 'users') {
      const limit = args[0] ? Number.parseInt(args[0], 10) : 10;
      const users = await getUsers(runtime, limit);
      console.log(JSON.stringify(users, null, 2));
    } else if (cmd === 'user') {
      const [userIdStr] = args;
      if (!userIdStr) {
        console.error('Usage: pnpm start -- user <userId>');
        process.exit(1);
      }
      const user = await getUserById(userIdStr, runtime);
      console.log(JSON.stringify(user, null, 2));
    } else if (cmd === 'posts') {
      const [userIdStr] = args;
      if (!userIdStr) {
        console.error('Usage: pnpm start -- posts <userId>');
        process.exit(1);
      }
      const posts = await getUserPosts(userIdStr, runtime);
      console.log(JSON.stringify(posts, null, 2));
    } else if (cmd === 'users-with-posts') {
      const limit = args[0] ? Number.parseInt(args[0], 10) : 10;
      const users = await getUsersWithPosts(runtime, limit);
      console.log(JSON.stringify(users, null, 2));
    } else if (cmd === 'similarity-search') {
      const [queryVectorStr, limitStr] = args;
      if (!queryVectorStr) {
        console.error('Usage: pnpm start -- similarity-search <queryVector> [limit]');
        console.error('  queryVector: JSON array of numbers, e.g., "[0.1,0.2,0.3]"');
        process.exit(1);
      }
      let queryVector: number[];
      try {
        queryVector = JSON.parse(queryVectorStr) as number[];
        if (!Array.isArray(queryVector) || !queryVector.every((v) => typeof v === 'number')) {
          throw new Error('queryVector must be an array of numbers');
        }
      } catch (error) {
        console.error(
          'Error parsing queryVector:',
          error instanceof Error ? error.message : String(error),
        );
        console.error('Expected JSON array of numbers, e.g., "[0.1,0.2,0.3]"');
        process.exit(1);
      }
      const limit = limitStr ? Number.parseInt(limitStr, 10) : 10;
      const results = await similaritySearch(queryVector, runtime, limit);
      console.log(JSON.stringify(results, null, 2));
    } else if (cmd === 'users-paginate') {
      const [cursorStr, limitStr] = args;
      const cursor = cursorStr ?? null;
      const limit = limitStr ? Number.parseInt(limitStr, 10) : 10;
      const users = await ormGetUsersByIdCursor(cursor, limit, runtime);
      console.log(JSON.stringify(users, null, 2));
    } else if (cmd === 'users-paginate-back') {
      const [cursorStr, limitStr] = args;
      if (!cursorStr) {
        console.error('Usage: pnpm start -- users-paginate-back <cursor> [limit]');
        process.exit(1);
      }
      const limit = limitStr ? Number.parseInt(limitStr, 10) : 10;
      const users = await ormGetUsersBackward(cursorStr, limit, runtime);
      console.log(JSON.stringify(users, null, 2));
    } else if (cmd === 'budget-violation') {
      console.log('Running unbounded query to demonstrate budget violation...');
      console.log('This query has no LIMIT clause and will trigger BUDGET.ROWS_EXCEEDED error.\n');
      try {
        const result = await getAllPostsUnbounded(runtime);
        console.log(JSON.stringify(result, null, 2));
      } catch (error) {
        console.error('Budget violation caught:');
        if (error instanceof Error) {
          const budgetError = error as { code?: string; category?: string; details?: unknown };
          console.error('  Code:', budgetError.code);
          console.error('  Category:', budgetError.category);
          console.error('  Message:', error.message);
          if (budgetError.details) {
            console.error('  Details:', JSON.stringify(budgetError.details, null, 2));
          }
        } else {
          console.error('  Error:', error);
        }
        throw error; // Re-throw to show the full error stack
      }
    } else if (cmd === 'user-kysely') {
      const [userIdStr] = args;
      if (!userIdStr) {
        console.error('Usage: pnpm start -- user-kysely <userId>');
        process.exit(1);
      }
      const user = await getUserByIdKysely(userIdStr, runtime);
      console.log(JSON.stringify(user, null, 2));
    } else if (cmd === 'posts-kysely') {
      const [userIdStr] = args;
      if (!userIdStr) {
        console.error('Usage: pnpm start -- posts-kysely <userId>');
        process.exit(1);
      }
      const posts = await getUserPostsKysely(userIdStr, runtime);
      console.log(JSON.stringify(posts, null, 2));
    } else if (cmd === 'users-kysely') {
      const limit = args[0] ? Number.parseInt(args[0], 10) : 10;
      const users = await getUsersKysely(runtime, limit);
      console.log(JSON.stringify(users, null, 2));
    } else if (cmd === 'users-with-posts-kysely') {
      const limit = args[0] ? Number.parseInt(args[0], 10) : 10;
      const users = await getUsersWithPostsKysely(runtime, limit);
      console.log(JSON.stringify(users, null, 2));
    } else if (cmd === 'user-transaction-kysely') {
      const newUser = await insertUserTransactionKysely(runtime);
      console.log('Inserted user:', JSON.stringify(newUser, null, 2));
    } else if (cmd === 'dml-kysely') {
      const [op, ...opArgs] = args;
      if (op === 'insert' && opArgs[0]) {
        const inserted = await insertUserKysely(opArgs[0], runtime);
        console.log('Inserted:', JSON.stringify(inserted, null, 2));
      } else if (op === 'update' && opArgs[0] && opArgs[1]) {
        const updated = await updateUserKysely(opArgs[0], opArgs[1], runtime);
        console.log('Updated:', JSON.stringify(updated, null, 2));
      } else if (op === 'delete' && opArgs[0]) {
        const deleted = await deleteUserKysely(opArgs[0], runtime);
        console.log('Deleted:', JSON.stringify(deleted, null, 2));
      } else {
        console.error(
          'Usage: pnpm start -- dml-kysely <insert email | update userId newEmail | delete userId>',
        );
        process.exit(1);
      }
    } else if (cmd === 'guardrail-delete-kysely') {
      console.log('Running DELETE without WHERE to demonstrate AST-based lint guardrail...');
      try {
        await deleteWithoutWhere(runtime);
        console.error('Unexpected: query should have been blocked by LINT.DELETE_WITHOUT_WHERE');
        process.exit(1);
      } catch (error) {
        const err = error as { code?: string; category?: string };
        if (err.code === 'LINT.DELETE_WITHOUT_WHERE' && err.category === 'LINT') {
          console.log('Guardrail correctly blocked execution:', err.code);
        } else {
          throw error;
        }
      }
    } else {
      console.log(
        'Usage: pnpm start -- [users [limit] | user <userId> | posts <userId> | ' +
          'users-with-posts [limit] | users-paginate [cursor] [limit] | ' +
          'users-paginate-back <cursor> [limit] | similarity-search <queryVector> [limit] | ' +
          'budget-violation | user-kysely <userId> | posts-kysely <userId> | users-kysely [limit] | ' +
          'users-with-posts-kysely [limit] | user-transaction-kysely | dml-kysely <op> <args...> | ' +
          'guardrail-delete-kysely]',
      );
      process.exit(1);
    }
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  } finally {
    await runtime.close();
  }
}

await main();
