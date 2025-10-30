import { getPrisma } from '../src/prisma/client';

async function main() {
  const prisma = getPrisma();
  await prisma.user.createMany({
    data: [
      { email: 'a@example.com', name: 'Alice' },
      { email: 'b@example.com', name: 'Bob' },
    ],
    skipDuplicates: true,
  });
}

main()
  .finally(async () => {
    await getPrisma().$disconnect();
  })
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
