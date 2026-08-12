import type { Contract } from '../contract/contract.d';

/**
 * The Supabase extension's own emitted contract type (`auth`, `storage`
 * namespaces), re-exported under a distinct name so the runtime facade can
 * reference it alongside the framework `Contract` (`@prisma-next/contract/types`)
 * without an aliased import. Backs the `service_role` `.supabase` secondary root.
 */
export type SupabaseExtensionContract = Contract;
