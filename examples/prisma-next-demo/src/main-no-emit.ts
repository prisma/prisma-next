/**
 * CLI Application Entry Point (No-Emit Workflow)
 *
 * Run with: pnpm start:no-emit -- <command> [args]
 *
 * Available commands:
 * - users [limit]              List users with optional limit
 * - user <id>                  Get user by ID
 * - posts <userId>             Get posts for a user
 */
import 'dotenv/config';
import { loadAppConfig } from './app-config';
import { getRuntime } from './prisma-no-emit/runtime';
import { getUserById } from './queries/get-user-by-id-no-emit';
import { getUserPosts } from './queries/get-user-posts-no-emit';
import { getUsers } from './queries/get-users-no-emit';

const argv = process.argv.slice(2).filter((arg) => arg !== '--');
const [cmd, ...args] = argv;

async function main() {
  const { databaseUrl } = loadAppConfig();
  const runtime = await getRuntime(databaseUrl);
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
      const user = await getUserById(userIdStr, runtime);
      console.log(JSON.stringify(user, null, 2));
    } else if (cmd === 'posts') {
      const [userIdStr] = args;
      if (!userIdStr) {
        console.error('Usage: pnpm start:no-emit -- posts <userId>');
        process.exit(1);
      }
      const posts = await getUserPosts(userIdStr, runtime);
      console.log(JSON.stringify(posts, null, 2));
    } else {
      console.log('Usage: pnpm start:no-emit -- [users [limit] | user <userId> | posts <userId>]');
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
