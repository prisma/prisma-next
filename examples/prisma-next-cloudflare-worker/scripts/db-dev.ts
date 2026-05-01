/**
 * Boots a local PGlite-backed Prisma Postgres instance via @prisma/dev and
 * prints the TCP URL to paste into `.env` as
 * WRANGLER_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE.
 *
 * Runs until SIGINT (Ctrl+C); persists nothing across restarts (default
 * persistenceMode is "stateless"), so re-run `pnpm db:init` and `pnpm seed`
 * after each restart.
 */
import { startPrismaDevServer } from '@prisma/dev';

const server = await startPrismaDevServer({
  databaseConnectTimeoutMillis: 60_000,
});

console.log('Prisma dev DB running.');
console.log(`TCP URL : ${server.database.connectionString}`);
console.log('(prisma dev also exposes an HTTP prisma+postgres:// URL that is Data-Proxy-style;');
console.log(' use the TCP URL above for postgresServerless / pg.)');
console.log('\nPaste the TCP URL into `.env` as');
console.log('  WRANGLER_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE="<url>"');
console.log('then in another terminal:');
console.log('  pnpm db:init    # apply schema');
console.log('  pnpm seed       # insert sample data');
console.log('  pnpm dev        # start wrangler dev\n');
console.log('Ctrl+C to stop.');

await new Promise<void>((resolve) => {
  process.once('SIGINT', () => resolve());
  process.once('SIGTERM', () => resolve());
});

await server.close();
