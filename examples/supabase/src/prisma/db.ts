import { type SupabaseDb, supabase } from '@prisma-next/extension-supabase/runtime';
import type { SqlMiddleware } from '@prisma-next/sql-runtime';
import type { Contract } from '../contract';
import contractJson from '../contract.json' with { type: 'json' };

export const TEST_JWT_SECRET = 'supabase-test-secret-that-is-long-enough-for-hs256';

export async function createDb(
  url: string,
  options?: { readonly middleware?: readonly SqlMiddleware[] },
): Promise<SupabaseDb<Contract>> {
  return supabase<Contract>({
    contractJson,
    url,
    jwtSecret: process.env['SUPABASE_JWT_SECRET'] ?? TEST_JWT_SECRET,
    ...options,
  });
}
