/**
 * CLI Application Entry Point (No-Emit Workflow)
 *
 * This is a command-line demo that showcases the "no-emit" workflow where the
 * contract is defined inline in TypeScript (prisma-no-emit/query-no-emit.ts)
 * rather than emitted to separate JSON/d.ts files.
 *
 * This workflow is useful for:
 * - Rapid prototyping without a build step
 * - Simpler projects that don't need contract serialization
 * - Understanding the contract structure before committing to emission
 *
 * Run with: pnpm start:no-emit -- <command> [args]
 *
 * Available commands:
 * - users [limit]              List users with optional limit
 * - user <id>                  Get user by ID
 * - posts <userId>             Get posts for a user
 * - users-with-posts [limit]   Users with nested posts
 *
 * See also:
 * - main.ts: Full CLI using emitted contract.json + contract.d.ts
 * - entry.ts: Browser app for visualizing contract.json
 */
import 'dotenv/config';
import { type as arktype } from 'arktype';
import { getRuntime } from './prisma-no-emit/runtime-no-emit';
import { getUserById } from './queries/get-user-by-id-no-emit';
import { getUserPosts } from './queries/get-user-posts-no-emit';
import { getUsers } from './queries/get-users-no-emit';
import { getUsersWithPosts } from './queries/get-users-with-posts-no-emit';

const appConfigSchema = arktype({
  DATABASE_URL: 'string',
});

function loadAppConfig() {
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
        console.error('Usage: pnpm start:no-emit -- user <userId>');
        process.exit(1);
      }
      const userId = Number.parseInt(userIdStr, 10);
      const user = await getUserById(userId, runtime);
      console.log(JSON.stringify(user, null, 2));
    } else if (cmd === 'posts') {
      const [userIdStr] = args;
      if (!userIdStr) {
        console.error('Usage: pnpm start:no-emit -- posts <userId>');
        process.exit(1);
      }
      const userId = Number.parseInt(userIdStr, 10);
      const posts = await getUserPosts(userId, runtime);
      console.log(JSON.stringify(posts, null, 2));
    } else if (cmd === 'users-with-posts') {
      const limit = args[0] ? Number.parseInt(args[0], 10) : 10;
      const users = await getUsersWithPosts(runtime, limit);
      console.log(JSON.stringify(users, null, 2));
    } else {
      console.log(
        'Usage: pnpm start:no-emit -- [users [limit] | user <userId> | posts <userId> | users-with-posts [limit]]',
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
