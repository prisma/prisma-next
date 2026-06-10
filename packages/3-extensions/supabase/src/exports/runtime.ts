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
export type {
  RoleSession,
  SupabaseRoleBinding,
  SupabaseRuntime,
} from '../runtime/supabase-runtime';
export { SupabaseRuntimeImpl } from '../runtime/supabase-runtime';
