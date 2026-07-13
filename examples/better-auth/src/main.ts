import { createAuth } from './auth';
import { createAppDb } from './prisma/db';
import { createAppServer } from './server';

const url = process.env['DATABASE_URL'];
if (!url) {
  console.error('Set DATABASE_URL to a Postgres connection string (see README).');
  process.exit(1);
}

const port = Number(process.env['PORT'] ?? 3000);
const appDb = createAppDb(url);
const auth = createAuth(appDb.authDb, { baseURL: `http://localhost:${port}` });
const server = createAppServer(auth, appDb);

server.listen(port, () => {
  console.log(`listening on http://localhost:${port}`);
  console.log('  POST /api/auth/sign-up/email  — create an account');
  console.log('  GET  /api/me                  — session + profile (authenticated)');
});
