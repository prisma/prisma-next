/**
 * CLI demo for Prisma Next on SQLite.
 *
 * Usage: `pnpm start -- <command> [args]`
 *
 * Commands:
 * - users [limit]                          List users via the SQL builder
 * - repo-user <id>                         Find a user by id via the ORM client
 * - repo-user-posts <id> [limit]           Fetch a user with their posts (relational include)
 * - repo-create-user <id> <email> <name>   Create a user via the ORM client
 * - insert-user <email> <name>             Insert a user via the SQL builder (INSERT … RETURNING)
 *
 * Each command opens a connection, runs the operation, prints the result as
 * JSON, and closes. Exits non-zero on usage errors or runtime failures.
 */
import 'dotenv/config';
import { loadAppConfig } from './app-config';
import { ormClientCreateUser } from './orm-client/create-user';
import { ormClientFindUserById } from './orm-client/find-user-by-id';
import { ormClientGetUserPosts } from './orm-client/get-user-posts';
import { db } from './prisma/db';
import { insertUser } from './queries/dml-operations';
import { getUsers } from './queries/get-users';

const argv = process.argv.slice(2).filter((arg) => arg !== '--');
const [cmd, ...args] = argv;

async function main() {
  const { databasePath } = loadAppConfig();
  const runtime = await db.connect({ path: databasePath });

  try {
    if (cmd === 'users') {
      const limit = args[0] ? Number.parseInt(args[0], 10) : 10;
      const users = await getUsers(limit);
      console.log(JSON.stringify(users, null, 2));
    } else if (cmd === 'repo-user') {
      const [id] = args;
      if (!id) {
        console.error('Usage: pnpm start -- repo-user <id>');
        process.exitCode = 1;
        return;
      }
      const user = await ormClientFindUserById(id, runtime);
      console.log(JSON.stringify(user, null, 2));
    } else if (cmd === 'repo-user-posts') {
      const [id, limitStr] = args;
      if (!id) {
        console.error('Usage: pnpm start -- repo-user-posts <id> [limit]');
        process.exitCode = 1;
        return;
      }
      const limit = limitStr ? Number.parseInt(limitStr, 10) : 10;
      const result = await ormClientGetUserPosts(id, limit, runtime);
      console.log(JSON.stringify(result, null, 2));
    } else if (cmd === 'repo-create-user') {
      const [id, email, displayName] = args;
      if (!id || !email || !displayName) {
        console.error('Usage: pnpm start -- repo-create-user <id> <email> <displayName>');
        process.exitCode = 1;
        return;
      }
      const user = await ormClientCreateUser(
        { id, email, displayName, createdAt: new Date() },
        runtime,
      );
      console.log(JSON.stringify(user, null, 2));
    } else if (cmd === 'insert-user') {
      const [email, displayName] = args;
      if (!email || !displayName) {
        console.error('Usage: pnpm start -- insert-user <email> <displayName>');
        process.exitCode = 1;
        return;
      }
      const user = await insertUser(email, displayName);
      console.log(JSON.stringify(user, null, 2));
    } else {
      console.log(
        'Usage: pnpm start -- [users [limit] | repo-user <id> | repo-user-posts <id> [limit] | ' +
          'repo-create-user <id> <email> <displayName> | insert-user <email> <displayName>]',
      );
      process.exitCode = 1;
      return;
    }
  } catch (error) {
    console.error('Error:', error);
    process.exitCode = 1;
  } finally {
    await runtime.close();
  }
}

await main();
