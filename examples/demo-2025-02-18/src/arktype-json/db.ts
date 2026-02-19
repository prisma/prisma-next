import postgres from '@prisma-next/postgres';
import type { Contract } from '../../prisma/arktype-json/contract.d';
import contractJson from '../../prisma/arktype-json/contract.json' with { type: 'json' };

export const arktypeDb = postgres<Contract>({
  contractJson,
  url:
    process.env['DATABASE_URL_ARKTYPE_JSON'] ??
    'postgresql://localhost:5432/demo_2025_02_18_arktype',
});
