import { PrismaClient } from '@prisma-next/compat-prisma';
import { getPrismaNextRuntime } from '../prisma-next/runtime';
import contract from '../prisma-next/contract.json' assert { type: 'json' };
import type { DataContract } from '@prisma-next/contract/types';

let prisma: PrismaClient | undefined;

export async function getPrisma() {
  if (!prisma) {
    const runtime = await getPrismaNextRuntime();
    prisma = new PrismaClient({
      contract: contract as DataContract,
      runtime,
    });
  }
  return prisma;
}

