import { getPrisma } from './prisma/client';
import { createUser } from './queries/create-user';
import { readUserById } from './queries/read-user';

const argv = process.argv.slice(2).filter((arg) => arg !== '--');
const [cmd, ...args] = argv;

(async () => {
  // Initialize Prisma client (checks USE_COMPAT env var internally)
  const prisma = await getPrisma();

  if (cmd === 'read') {
    const [id] = args;
    if (!id) {
      console.error('Usage: pnpm start -- read <id>');
      process.exit(1);
    }
    const result = await readUserById(id);
    console.log(JSON.stringify(result, null, 2));
  } else if (cmd === 'create') {
    const [email, name] = args;
    if (!email || !name) {
      console.error('Usage: pnpm start -- create <email> <name>');
      process.exit(1);
    }
    const result = await createUser({ email, name });
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log('Usage: pnpm start -- [read <id> | create <email> <name>]');
    process.exit(1);
  }

  await prisma.$disconnect();
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
