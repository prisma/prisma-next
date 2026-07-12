/**
 * Supabase runtime-role handles exported from
 * `@prisma-next/extension-supabase/contract`: `anon` and `authenticated` are
 * plain RLS role handles (built with the postgres contract-builder's
 * `role(...)`) usable in a policy's `roles:` list. Supabase provisions these
 * roles at runtime — referencing them lowers to bare names without declaring
 * them, matching PSL's bare-identifier pass-through.
 */
import { describe, expect, it } from 'vitest';
import { anon, authenticated } from '../src/exports/contract';

describe('supabase role handles', () => {
  it('anon and authenticated are frozen role handles carrying their bare names', () => {
    expect(anon).toEqual({ entityKind: 'role', name: 'anon' });
    expect(authenticated).toEqual({ entityKind: 'role', name: 'authenticated' });
    expect(Object.isFrozen(anon)).toBe(true);
    expect(Object.isFrozen(authenticated)).toBe(true);
  });
});
