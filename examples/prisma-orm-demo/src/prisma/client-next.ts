import { PrismaClient } from '@prisma-next/compat-prisma';
import { getPrismaNextRuntime } from '../prisma-next/runtime';
import contractJson from '../prisma-next/contract.json' assert { type: 'json' };
import { validateContract } from '@prisma-next/sql/schema';

let prisma: PrismaClient | undefined;

export async function getPrisma() {
  if (!prisma) {
    const runtime = await getPrismaNextRuntime();
    const contract = validateContract(contractJson);
    prisma = new PrismaClient({
      contract,
      runtime,
    });
  }
  return prisma;
}
