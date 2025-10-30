import { getPrisma } from '../prisma/client';

export async function createUser(input: { email: string; name: string }) {
  return getPrisma().user.create({ data: input });
}
