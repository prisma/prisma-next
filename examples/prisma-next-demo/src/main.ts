import 'dotenv/config';
import { closeRuntime, getRuntime } from './prisma/runtime';
import { getAllPostsUnbounded } from './queries/get-all-posts-unbounded';
import { getUserById } from './queries/get-user-by-id';
import { getUserPosts } from './queries/get-user-posts';
import { getUsers } from './queries/get-users';
import { getUsersWithPosts } from './queries/get-users-with-posts';
import { ormGetUsersBackward, ormGetUsersByIdCursor } from './queries/orm-pagination';
import { similaritySearch } from './queries/similarity-search';
import { type as arktype } from 'arktype';

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
  const { databaseUrl } = loadAppConfig();
  const runtime = getRuntime(databaseUrl);
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
      const userId = Number.parseInt(userIdStr, 10);
      const user = await getUserById(userId, runtime);
      console.log(JSON.stringify(user, null, 2));
    } else if (cmd === 'posts') {
      const [userIdStr] = args;
      if (!userIdStr) {
        console.error('Usage: pnpm start -- posts <userId>');
        process.exit(1);
      }
      const userId = Number.parseInt(userIdStr, 10);
      const posts = await getUserPosts(userId, runtime);
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
      const cursor = cursorStr ? Number.parseInt(cursorStr, 10) : null;
      const limit = limitStr ? Number.parseInt(limitStr, 10) : 10;
      const users = await ormGetUsersByIdCursor(cursor, limit, runtime);
      console.log(JSON.stringify(users, null, 2));
    } else if (cmd === 'users-paginate-back') {
      const [cursorStr, limitStr] = args;
      if (!cursorStr) {
        console.error('Usage: pnpm start -- users-paginate-back <cursor> [limit]');
        process.exit(1);
      }
      const cursor = Number.parseInt(cursorStr, 10);
      const limit = limitStr ? Number.parseInt(limitStr, 10) : 10;
      const users = await ormGetUsersBackward(cursor, limit, runtime);
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
    } else {
      console.log(
        'Usage: pnpm start -- [users [limit] | user <userId> | posts <userId> | ' +
          'users-with-posts [limit] | users-paginate [cursor] [limit] | ' +
          'users-paginate-back <cursor> [limit] | similarity-search <queryVector> [limit] | ' +
          'budget-violation]',
      );
      process.exit(1);
    }
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  } finally {
    await closeRuntime();
  }
}

await main();
