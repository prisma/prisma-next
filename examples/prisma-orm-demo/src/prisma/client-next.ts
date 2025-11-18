import { PrismaClient } from '@prisma-next/compat-prisma';
import { validateContract } from '@prisma-next/sql-contract-ts/contract';
import contractJson from '../prisma-next/contract.json' with { type: 'json' };

import { getPrismaNextRuntime } from '../prisma-next/runtime';

let prisma: PrismaClient | undefined;

export async function getPrisma() {
  if (!prisma) {
    const runtime = getPrismaNextRuntime();
    const contract = validateContract(contractJson);
    prisma = new PrismaClient({
      contract,
      runtime,
    });
  }
  return prisma;
}
