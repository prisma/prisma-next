import supabase from '@prisma-next/extension-supabase/runtime';
import { createTelemetryMiddleware } from '@prisma-next/middleware-telemetry';
import { budgets, lints } from '@prisma-next/sql-runtime';
import type { Contract, TypeMaps } from './contract.d';
import contractJson from './contract.json' with { type: 'json' };

// The supabase() facade composes the underlying Postgres runtime internally.
// The returned `db` is a SupabaseDb<Contract, TypeMaps> — it has no top-level
// `db.sql.*` accessor. Callers must select a role (`asUser` / `asAnon` /
// `asServiceRole`) before building queries. This is intentional: in a Supabase
// app there is no meaningful "no role" execution context.
//
// DESIGN HOLE #7: middleware on the SupabaseDb facade. The existing postgres()
// runtime accepts `middleware: [...]`. The supabase() facade must accept the
// same so users can compose telemetry, lints, budgets, etc.
//
// DESIGN HOLE #8: ordering vs the supabase role-binding middleware. The
// facade installs its own middleware to issue SET LOCAL on each scoped session.
// User middleware should run *outside* that (so telemetry sees the user-issued
// query, not the SET LOCAL plumbing). Document the ordering contract.
//
// DESIGN HOLE #9: TypeMaps source. The existing demo imports `Contract` from
// `./contract.d`; this example also imports `TypeMaps`. Confirm the emitter
// generates both.
export const db = supabase<Contract, TypeMaps>({
  contractJson,
  // biome-ignore lint/style/noNonNullAssertion: loaded from .env
  url: process.env['DATABASE_URL']!,
  // Either jwtSecret (HS256 shared secret) or jwksUrl (asymmetric, fetched).
  // biome-ignore lint/style/noNonNullAssertion: loaded from .env
  jwtSecret: process.env['SUPABASE_JWT_SECRET']!,
  // jwksUrl: process.env['SUPABASE_JWKS_URL'],
  middleware: [
    createTelemetryMiddleware(),
    lints(),
    budgets({
      maxRows: 10_000,
      defaultTableRows: 10_000,
      maxLatencyMs: 1_000,
    }),
  ],
});
