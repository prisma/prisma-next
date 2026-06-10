import type { SqlRuntimeExtensionDescriptor } from '@prisma-next/sql-runtime';
import packageJson from '../../package.json' with { type: 'json' };

/**
 * Runtime extension descriptor for the Supabase pack. Satisfies the runtime
 * contract-requirements check for contracts that declare `extensionPacks:
 * [supabasePack]`; the `supabase()` factory registers it automatically.
 */
export const supabaseRuntimeDescriptor: SqlRuntimeExtensionDescriptor<'postgres'> = {
  kind: 'extension' as const,
  id: 'supabase',
  version: packageJson.version,
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
