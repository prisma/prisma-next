import 'dotenv/config';
import { closeRuntime } from './prisma/runtime';
import { getUserById } from './queries/get-user-by-id';
import { getUserPosts } from './queries/get-user-posts';
import { getUsers } from './queries/get-users';
import { getUsersWithPosts } from './queries/get-users-with-posts';

const argv = process.argv.slice(2).filter((arg) => arg !== '--');
const [cmd, ...args] = argv;

async function main() {
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
      const userId = Number.parseInt(userIdStr, 10);
      const user = await getUserById(userId);
      console.log(JSON.stringify(user, null, 2));
    } else if (cmd === 'posts') {
      const [userIdStr] = args;
      if (!userIdStr) {
        console.error('Usage: pnpm start -- posts <userId>');
        process.exit(1);
      }
      const userId = Number.parseInt(userIdStr, 10);
      const posts = await getUserPosts(userId);
      console.log(JSON.stringify(posts, null, 2));
    } else if (cmd === 'users-with-posts') {
      const limit = args[0] ? Number.parseInt(args[0], 10) : 10;
      const users = await getUsersWithPosts(limit);
      console.log(JSON.stringify(users, null, 2));
    } else {
      console.log(
        'Usage: pnpm start -- [users [limit] | user <userId> | posts <userId> | users-with-posts [limit]]',
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
