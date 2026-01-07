import { getPrisma } from '../prisma/client.ts';

export async function readUserById(id: string) {
  const prisma = await getPrisma();
  return prisma.user.findUnique({ where: { id } });
}
