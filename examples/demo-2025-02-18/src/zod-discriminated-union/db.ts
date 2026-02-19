import postgres from '@prisma-next/postgres';
import type { Contract } from '../../prisma/zod-discriminated-union/contract.d';
import contractJson from '../../prisma/zod-discriminated-union/contract.json' with { type: 'json' };

export const zodDb = postgres<Contract>({
  contractJson,
  url: process.env['DATABASE_URL_ZOD_UNION'] ?? 'postgresql://localhost:5432/demo_2025_02_18_zod',
});
