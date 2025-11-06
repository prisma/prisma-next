import { PrismaClient as CompatPrismaClient } from '@prisma-next/compat-prisma';
import { validateContract } from '@prisma-next/sql-query/schema';
import type { SqlContract } from '@prisma-next/sql-target';
import { PrismaClient as LegacyPrismaClient } from '@prisma/client';
import contract from '../prisma-next/contract.json' assert { type: 'json' };
import { getPrismaNextRuntime } from '../prisma-next/runtime';

let legacyPrisma: LegacyPrismaClient | undefined;
let compatPrisma: CompatPrismaClient | undefined;

/**
 * Get Prisma Client instance
 * Uses Prisma Next compatibility layer if USE_COMPAT=true, otherwise uses legacy Prisma Client
 * @returns Prisma Client instance
 */
export async function getPrisma() {
  // Check USE_COMPAT env var
  const useCompat = process.env.USE_COMPAT === 'true';

  if (useCompat) {
    // Use Prisma Next compatibility layer
    if (!compatPrisma) {
      const runtime = getPrismaNextRuntime();
      compatPrisma = new CompatPrismaClient({
        contract: validateContract<SqlContract>(contract),
        runtime,
      });
    }
    return compatPrisma;
  }
  // Use legacy Prisma Client
  if (!legacyPrisma) {
    legacyPrisma = new LegacyPrismaClient();
  }
  return legacyPrisma;
}
