import { role } from '@prisma-next/postgres/contract-builder';

/**
 * Supabase's runtime request roles, for use in a policy's `roles:` list.
 * Supabase provisions these on every project — the contract does not declare
 * them; referencing one lowers to its bare name, matching PSL's
 * bare-identifier pass-through.
 */
export const anon = role('anon');
export const authenticated = role('authenticated');
