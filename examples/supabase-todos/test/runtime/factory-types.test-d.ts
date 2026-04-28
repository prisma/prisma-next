/**
 * Type-level test for `createSupabaseRuntime`.
 *
 * Asserts that the factory's `authenticate()` returns something
 * structurally compatible with the framework's `SqlRuntime` (R-NF-3).
 * If the upstream `Runtime` shape grows a method, this file fails
 * to compile, signalling the factory needs to be updated to keep
 * its `SupabaseSession ⊆ SqlRuntime` invariant.
 *
 * ## Why `satisfies`, not `expectTypeOf`
 *
 * `expectTypeOf(...).toMatchTypeOf()` rejected branded codec types in
 * `admin.test.ts`; we used `satisfies` as the workaround. The assertion
 * is structurally identical (the value must be assignable to the asserted
 * type) and the failure mode is a clear `tsc` error pointing at the
 * missing-or-wider field. No vitest typecheck mode is configured for this
 * package; the gate is `pnpm --filter supabase-todos typecheck`
 * (`tsc --noEmit`), which picks this file up via the test glob include
 * in `tsconfig.json`.
 *
 * The file extension is `.test-d.ts` so it is excluded from vitest's
 * default test discovery (which matches `*.test.ts` only) — it has no
 * runtime body, only type-level assertions.
 *
 * @see projects/supabase-poc/spec.md § R-NF-3
 */

import type { Contract as FrameworkContract } from '@prisma-next/contract/types';
import type { SqlStorage } from '@prisma-next/sql-contract/types';
import type { Runtime } from '@prisma-next/sql-runtime';
import type { Pool } from 'pg';
import type { Contract } from '../../src/db/contract.d';
import type { AdminDb } from '../../src/server/db';
import {
  createSupabaseRuntime,
  type SupabaseRuntimeFactory,
  type SupabaseRuntimeOptions,
  type SupabaseSession,
} from '../../src/server/supabase-runtime';

declare const adminDb: AdminDb;
declare const pool: Pool;

// Pin `createSupabaseRuntime`'s call signature: it must accept a
// `SupabaseRuntimeOptions<TContract>` and return a `SupabaseRuntimeFactory`.
// (Asserting `factory satisfies SupabaseRuntimeFactory` would be tautological
// — the factory's declared return type *is* `SupabaseRuntimeFactory`, so the
// assertion would only fail if the export disappears entirely. Pinning the
// call signature instead catches drift in *either* the input options or the
// return type.)
createSupabaseRuntime satisfies <TContract extends FrameworkContract<SqlStorage>>(
  options: SupabaseRuntimeOptions<TContract>,
) => SupabaseRuntimeFactory;

const factory = createSupabaseRuntime<Contract>({
  context: adminDb.context,
  pool,
  scopeMode: 'transaction',
  allowedRoles: ['authenticated', 'anon'],
});

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
