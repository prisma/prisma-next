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
 * - repo-users [limit]         Users via ORM client API
 * - repo-admins [limit]        Admin users via custom collection scope
 * - repo-user <email>          Find a user by email via ORM client first()
 * - repo-posts <userId> [limit] Posts for a user via ORM client API
 * - repo-dashboard <emailDomain> <postTitleTerm> [limit] [postsPerUser]
 *                              Compound filters + select/include via ORM client
 * - repo-post-feed <postTitleTerm> [limit]
 *                              Posts with to-one include via ORM client
 * - repo-users-cursor [cursor] [limit]
 *                              Cursor pagination via ORM client
 * - repo-latest-per-kind       DISTINCT ON example via ORM client
 * - repo-user-insights [limit]
 *                              include().combine() metrics + latest related row
 * - repo-kind-breakdown [minUsers]
 *                              groupBy().having().aggregate() example
 * - repo-upsert-user <id> <email> <kind>
 *                              upsert() example for id conflict
 * - users-paginate [cursor]    Cursor-based pagination
 * - similarity-search <vec>    Vector similarity search (pgvector)
 * - budget-violation           Demo budget enforcement error
 * - guardrail-delete           Demo AST lint blocking DELETE without WHERE
 *
 * See also:
 * - main-no-emit.ts: Same CLI using inline contract (no emission step)
 * - src/app/main.tsx: React browser app for visualizing contract.json
 */
import 'dotenv/config';
import { loadAppConfig } from './app-config';
import { ormClientFindUserByEmail } from './orm-client/find-user-by-email';
import { ormClientGetAdminUsers } from './orm-client/get-admin-users';
import { ormClientGetDashboardUsers } from './orm-client/get-dashboard-users';
import { ormClientGetLatestUserPerKind } from './orm-client/get-latest-user-per-kind';
import { ormClientGetPostFeed } from './orm-client/get-post-feed';
import { ormClientGetUserInsights } from './orm-client/get-user-insights';
import { ormClientGetUserKindBreakdown } from './orm-client/get-user-kind-breakdown';
import { ormClientGetUserPosts } from './orm-client/get-user-posts';
import { ormClientGetUsers } from './orm-client/get-users';
import { ormClientGetUsersBackwardCursor } from './orm-client/get-users-backward-cursor';
import { ormClientGetUsersByIdCursor } from './orm-client/get-users-by-id-cursor';
import { ormClientUpsertUser } from './orm-client/upsert-user';
import { db } from './prisma/db';
import { deleteWithoutWhere } from './queries/delete-without-where';
import { getAllPostsUnbounded } from './queries/get-all-posts-unbounded';
import { getUserById } from './queries/get-user-by-id';
import { getUserPosts } from './queries/get-user-posts';
import { getUsers } from './queries/get-users';
import { similaritySearch } from './queries/similarity-search';

const argv = process.argv.slice(2).filter((arg) => arg !== '--');
const [cmd, ...args] = argv;

async function main() {
  const { databaseUrl } = loadAppConfig();
  const runtime = await db.connect({ url: databaseUrl });

  try {
    if (cmd === 'users') {
      const limit = args[0] ? Number.parseInt(args[0], 10) : 10;
      const users = await getUsers(limit);

      console.log(JSON.stringify(users, null, 2));
    } else if (cmd === 'user') {
      const [userIdStr] = args;
      if (!userIdStr) {
        console.error('Usage: pnpm start -- user <userId>');
        process.exit(1);
      }
      const user = await getUserById(userIdStr);

      console.log(JSON.stringify(user, null, 2));
    } else if (cmd === 'posts') {
      const [userIdStr] = args;
      if (!userIdStr) {
        console.error('Usage: pnpm start -- posts <userId>');
        process.exit(1);
      }
      const posts = await getUserPosts(userIdStr);

      console.log(JSON.stringify(posts, null, 2));
    } else if (cmd === 'repo-users') {
      const limit = args[0] ? Number.parseInt(args[0], 10) : 10;
      const users = await ormClientGetUsers(limit, runtime);

      console.log(JSON.stringify(users, null, 2));
    } else if (cmd === 'repo-admins') {
      const limit = args[0] ? Number.parseInt(args[0], 10) : 10;
      const users = await ormClientGetAdminUsers(limit, runtime);

      console.log(JSON.stringify(users, null, 2));
    } else if (cmd === 'repo-user') {
      const [email] = args;
      if (!email) {
        console.error('Usage: pnpm start -- repo-user <email>');
        process.exit(1);
      }
      const user = await ormClientFindUserByEmail(email, runtime);

      console.log(JSON.stringify(user, null, 2));
    } else if (cmd === 'repo-posts') {
      const [userIdStr, limitStr] = args;
      if (!userIdStr) {
        console.error('Usage: pnpm start -- repo-posts <userId> [limit]');
        process.exit(1);
      }
      const limit = limitStr ? Number.parseInt(limitStr, 10) : 10;
      const posts = await ormClientGetUserPosts(userIdStr, limit, runtime);

      console.log(JSON.stringify(posts, null, 2));
    } else if (cmd === 'repo-dashboard') {
      const [emailDomain, postTitleTerm, limitStr, postsPerUserStr] = args;
      if (!emailDomain || !postTitleTerm) {
        console.error(
          'Usage: pnpm start -- repo-dashboard <emailDomain> <postTitleTerm> [limit] [postsPerUser]',
        );
        process.exit(1);
      }
      const limit = limitStr ? Number.parseInt(limitStr, 10) : 10;
      const postsPerUser = postsPerUserStr ? Number.parseInt(postsPerUserStr, 10) : 2;
      const users = await ormClientGetDashboardUsers(
        emailDomain,
        postTitleTerm,
        limit,
        postsPerUser,
        runtime,
      );

      console.log(JSON.stringify(users, null, 2));
    } else if (cmd === 'repo-post-feed') {
      const [postTitleTerm, limitStr] = args;
      if (!postTitleTerm) {
        console.error('Usage: pnpm start -- repo-post-feed <postTitleTerm> [limit]');
        process.exit(1);
      }
      const limit = limitStr ? Number.parseInt(limitStr, 10) : 10;
      const posts = await ormClientGetPostFeed(postTitleTerm, limit, runtime);

      console.log(JSON.stringify(posts, null, 2));
    } else if (cmd === 'repo-users-cursor') {
      const [cursorStr, limitStr] = args;
      const cursor = cursorStr ?? null;
      const limit = limitStr ? Number.parseInt(limitStr, 10) : 10;
      const users = await ormClientGetUsersByIdCursor(cursor, limit, runtime);

      console.log(JSON.stringify(users, null, 2));
    } else if (cmd === 'repo-latest-per-kind') {
      const users = await ormClientGetLatestUserPerKind(runtime);

      console.log(JSON.stringify(users, null, 2));
    } else if (cmd === 'repo-user-insights') {
      const limit = args[0] ? Number.parseInt(args[0], 10) : 10;
      const users = await ormClientGetUserInsights(limit, runtime);

      console.log(JSON.stringify(users, null, 2));
    } else if (cmd === 'repo-kind-breakdown') {
      const minUsers = args[0] ? Number.parseInt(args[0], 10) : 1;
      const rows = await ormClientGetUserKindBreakdown(minUsers, runtime);

      console.log(JSON.stringify(rows, null, 2));
    } else if (cmd === 'repo-upsert-user') {
      const [id, email, kind] = args;
      if (!id || !email || !kind) {
        console.error('Usage: pnpm start -- repo-upsert-user <id> <email> <kind>');
        process.exit(1);
      }
      if (kind !== 'admin' && kind !== 'user') {
        console.error('repo-upsert-user kind must be "admin" or "user"');
        process.exit(1);
      }
      const user = await ormClientUpsertUser({ id, email, kind }, runtime);

      console.log(JSON.stringify(user, null, 2));
    } else if (cmd === 'users-paginate') {
      const [cursorStr, limitStr] = args;
      const cursor = cursorStr ?? null;
      const limit = limitStr ? Number.parseInt(limitStr, 10) : 10;
      const users = await ormClientGetUsersByIdCursor(cursor, limit, runtime);

      console.log(JSON.stringify(users, null, 2));
    } else if (cmd === 'users-paginate-back') {
      const [cursorStr, limitStr] = args;
      if (!cursorStr) {
        console.error('Usage: pnpm start -- users-paginate-back <cursor> [limit]');
        process.exit(1);
      }
      const limit = limitStr ? Number.parseInt(limitStr, 10) : 10;
      const users = await ormClientGetUsersBackwardCursor(cursorStr, limit, runtime);

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
      const results = await similaritySearch(queryVector, limit);

      console.log(JSON.stringify(results, null, 2));
    } else if (cmd === 'budget-violation') {
      console.log('Running unbounded query to demonstrate budget violation...');

      console.log('This query has no LIMIT clause and will trigger BUDGET.ROWS_EXCEEDED error.\n');
      try {
        const result = await getAllPostsUnbounded();

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
    } else if (cmd === 'guardrail-delete') {
      console.log('Running DELETE without WHERE to demonstrate AST-based lint guardrail...');
      try {
        await deleteWithoutWhere();
        console.error('Unexpected: query should have been blocked by LINT.DELETE_WITHOUT_WHERE');
        process.exit(1);
      } catch (error) {
        if (
          typeof error === 'object' &&
          error !== null &&
          Object.hasOwn(error, 'code') &&
          Reflect.get(error, 'code') === 'LINT.DELETE_WITHOUT_WHERE'
        ) {
          console.log('Guardrail correctly blocked execution: LINT.DELETE_WITHOUT_WHERE');
        } else {
          throw error;
        }
      }
    } else {
      console.log(
        'Usage: pnpm start -- [users [limit] | user <userId> | posts <userId> | ' +
          'repo-users [limit] | repo-admins [limit] | ' +
          'repo-user <email> | repo-posts <userId> [limit] | ' +
          'repo-dashboard <emailDomain> <postTitleTerm> [limit] [postsPerUser] | ' +
          'repo-post-feed <postTitleTerm> [limit] | repo-users-cursor [cursor] [limit] | ' +
          'repo-latest-per-kind | repo-user-insights [limit] | repo-kind-breakdown [minUsers] | ' +
          'repo-upsert-user <id> <email> <kind> | users-paginate [cursor] [limit] | ' +
          'users-paginate-back <cursor> [limit] | similarity-search <vec> [limit] | ' +
          'budget-violation | guardrail-delete]',
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
