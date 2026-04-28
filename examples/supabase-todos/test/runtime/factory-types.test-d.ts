/**
 * Type-level test for `createSupabaseRuntime` (T2.3).
 *
 * Asserts that the factory's `authenticate()` returns something
 * structurally compatible with the framework's `SqlRuntime` (R-NF-3).
 * If the upstream `Runtime` shape grows a method, this file fails
 * to compile, signalling the factory needs to be updated to keep
 * its `SupabaseSession ⊆ SqlRuntime` invariant.
 *
 * ## Why `satisfies`, not `expectTypeOf`
 *
 * The plan calls out (T1.9 retro) that `expectTypeOf(...).toMatchTypeOf()`
 * rejected branded codec types in `admin.test.ts`, with `satisfies` used
 * as the workaround. There is no other type-test precedent in
 * `examples/supabase-todos/test/`, so we stick with `satisfies` here for
 * consistency: the assertion is structurally identical (the value must be
 * assignable to the asserted type) and the failure mode is a clear `tsc`
 * error pointing at the missing-or-wider field. No vitest typecheck mode
 * is configured for this package; the gate is `pnpm --filter
 * supabase-todos typecheck` (`tsc --noEmit`), which picks this file up
 * via the test glob include in `tsconfig.json`.
 *
 * The file extension is `.test-d.ts` so it is excluded from vitest's
 * default test discovery (which matches `*.test.ts` only) — it has no
 * runtime body, only type-level assertions.
 *
 * @see projects/supabase-poc/spec.md § R-NF-3
 * @see projects/supabase-poc/plan.md § Milestone 2 → 2.3
 */
import type { Runtime } from '@prisma-next/sql-runtime';
import type { Pool } from 'pg';
import type { Contract } from '../../src/db/contract.d';
import type { AdminDb } from '../../src/server/db';
import {
  createSupabaseRuntime,
  type SupabaseRuntimeFactory,
  type SupabaseSession,
} from '../../src/server/supabase-runtime';

declare const adminDb: AdminDb;
declare const pool: Pool;

const factory = createSupabaseRuntime<Contract>({
  context: adminDb.context,
  pool,
  scopeMode: 'transaction',
  allowedRoles: ['authenticated', 'anon'],
});

// Factory shape is the public type.
factory satisfies SupabaseRuntimeFactory;

const session = factory.authenticate({
  jwtClaims: { sub: 'fixture-uuid', role: 'authenticated' },
  role: 'authenticated',
});

// The session is structurally a `SqlRuntime` — this is the R-NF-3 guarantee.
// If `Runtime` grows a method that `SupabaseSession` does not implement, this
// `satisfies` fails at compile time.
session satisfies Runtime;

// And it carries the additional methods the spec promises on top.
session satisfies SupabaseSession;

// `beginTransaction()` is `() => never` (R-FX-8) — the type checks both that
// the method exists and that it's typed as a synchronous throw rather than
// `Promise<SqlTransaction>` (which would mislead callers into `await`-ing it).
const _begin: () => never = session.beginTransaction.bind(session);
void _begin;

// `end()` is `() => Promise<void>`.
const _end: () => Promise<void> = session.end.bind(session);
void _end;
