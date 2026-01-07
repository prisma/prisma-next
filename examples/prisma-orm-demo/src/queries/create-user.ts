import { getPrisma } from '../prisma/client.ts';

export async function createUser(input: { email: string; name: string }) {
  const prisma = await getPrisma();
  return prisma.user.create({ data: input });
}
