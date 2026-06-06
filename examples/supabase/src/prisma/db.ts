import supabaseRuntime from '@prisma-next/extension-supabase/runtime';
import postgres from '@prisma-next/postgres/runtime';
import type { Contract } from '../contract';
import contractJson from '../contract.json' with { type: 'json' };

export const db = postgres<Contract>({
  contractJson,
  extensions: [supabaseRuntime],
});
