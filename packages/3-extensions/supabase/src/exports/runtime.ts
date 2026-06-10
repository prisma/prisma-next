import { supabaseRuntimeDescriptor } from '../runtime/descriptor';

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
