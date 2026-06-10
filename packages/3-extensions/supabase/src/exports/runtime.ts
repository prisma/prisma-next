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

export type {
  RoleBoundDb,
  SupabaseDb,
  SupabaseOptions,
  SupabaseOptionsWithContract,
  SupabaseOptionsWithContractJson,
  SupabaseTargetId,
} from '../runtime/supabase';
export { default as supabase, InvalidJwtError, SupabaseConfigError } from '../runtime/supabase';
export type { SupabaseRoleBinding } from '../runtime/supabase-runtime';
export { SupabaseRuntime } from '../runtime/supabase-runtime';
