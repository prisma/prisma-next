import 'dotenv/config';
import { getPrisma } from '../src/prisma/client.ts';

async function main() {
  // Seed script uses Prisma Client based on USE_COMPAT env var (defaults to legacy)
  const prisma = await getPrisma();

  // Use individual creates since createMany is not implemented in compat layer MVP
  await prisma.user.create({ data: { email: 'a@example.com', name: 'Alice' } });
  await prisma.user.create({ data: { email: 'b@example.com', name: 'Bob' } });
}

main()
  .finally(async () => {
    const prisma = await getPrisma();
    await prisma.$disconnect();
  })
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
