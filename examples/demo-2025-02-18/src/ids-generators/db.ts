import postgres from '@prisma-next/postgres';
import type { Contract } from '../../prisma/ids-generators/contract.d';
import contractJson from '../../prisma/ids-generators/contract.json' with { type: 'json' };

export const idsDb = postgres<Contract>({
  contractJson,
  url: process.env['DATABASE_URL_IDS'] ?? 'postgresql://localhost:5432/demo_2025_02_18_ids',
});
