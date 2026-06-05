/**
 * Minimal M1 runtime descriptor for the Supabase extension.
 *
 * The Supabase pack contributes no runtime codec types or query operations in
 * M1 — `auth.*`/`storage.*` are external tables accessed via the stock
 * postgres runtime, not through a custom codec or operation surface. This
 * descriptor exists so the postgres runtime's contract-requirements check
 * (which verifies every `extensionPacks` entry in the emitted `contract.json`
 * has a matching runtime component) passes.
 *
 * TODO(M2): Replace with the real SupabaseRuntime that adds
 *   `asUser()`/`asAnon()` role-binding and the Supabase auth surface.
 */
import type { SqlRuntimeExtensionDescriptor } from '@prisma-next/sql-runtime';

const supabaseRuntimeDescriptor: SqlRuntimeExtensionDescriptor<'postgres'> = {
  kind: 'extension' as const,
  id: 'supabase',
  version: '0.12.0',
  familyId: 'sql' as const,
  targetId: 'postgres' as const,
  codecs: () => [],
  create() {
    return {
      familyId: 'sql' as const,
      targetId: 'postgres' as const,
    };
  },
};

export default supabaseRuntimeDescriptor;
