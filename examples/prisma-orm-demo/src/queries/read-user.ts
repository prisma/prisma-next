import { getPrisma } from '../prisma/client';

export async function readUserById(id: string) {
  return getPrisma().user.findUnique({ where: { id } });
}
