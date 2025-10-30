import { createUser } from './queries/create-user';
import { readUserById } from './queries/read-user';
import { getPrisma } from './prisma/client';

const argv = process.argv.slice(2).filter((arg) => arg !== '--');
const [cmd, ...args] = argv;

(async () => {
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
})().finally(async () => {
  await getPrisma().$disconnect();
});
