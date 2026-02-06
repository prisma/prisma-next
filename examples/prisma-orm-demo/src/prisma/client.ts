import { PrismaClient } from '@prisma/client';

let prisma: PrismaClient | undefined;

export async function getPrisma() {
  if (!prisma) {
    prisma = new PrismaClient();
  }
  return prisma;
}
