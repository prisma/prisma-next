# Slice D — `service_role` queries Supabase-internal namespaces via the facade

**Project:** extension-supabase (TML-2503) · **Spec:** [`../../spec.md`](../../spec.md) · **Plan:** [`../../plan.md`](../../plan.md)

## Why now

Independent of postgres-rls #771 (which is blocked) — this is facade composition, not RLS. Good use of the wait.

## The capability

`db.asServiceRole()` exposes the Supabase-internal namespaces (`auth`, `storage`) on its query surface, **flat**, alongside the app's own namespaces:

```ts
const admin = db.asServiceRole();
admin.sql.auth.users.select({ … })       // ✅ service_role has grants + BYPASSRLS
admin.sql.public.profile.select({ … })   // app tables too

db.asAnon().sql.public.profile            // ✅ app namespaces only
db.asAnon().sql.auth                      // ✗ not on the type — anon/authenticated have no auth.* grants
```

The capability is **bound to the role that actually holds the grant.** Only `service_role` can read `auth.*` over a direct Postgres connection, so the internal namespaces appear *only* on the `asServiceRole()`-bound db. `asUser(jwt)` / `asAnon()` expose only the app contract's namespaces — `auth.*` is absent from their type (correct: those roles can't read it).

No `internal`/`admin` sub-grouping — the `auth` / `storage` namespace names already signal "Supabase-owned."

## Design constraints

- **Facade-local composition.** The supabase package ships the Supabase contract (with `auth.*`/`storage.*` as queryable tables). The facade composes those namespaces into the execution context **for the `service_role` path only**. This does **not** use generic cross-space querying (deliberately not built in cross-contract-refs); the facade owns both contracts, so it merges them itself.
- **Replaces the interim workaround.** No separate `createSupabaseExtensionDb` instance, no second connection pool, and **no `contractJson` export on `/contract`** (if the facade needs the contract internally, it imports it package-internally — not as a public `/contract` export) unless implementation proves a public export is genuinely required (flag if so).
- **App db unchanged for `asUser`/`asAnon`.** Their query surface is exactly today's (app namespaces only). This slice only *adds* namespaces on the `service_role` path.

## Done conditions (operator-observable)

- An integration test (PGlite + `bootstrapSupabaseShim`, `service_role`) reads a seeded `auth.users` row via `db.asServiceRole().sql.auth.users…`, asserts the row **and** that the emitted SQL targets `"auth"."users"`.
- A type-level assertion that `db.asAnon()` / `db.asUser(jwt)` do **not** expose `.sql.auth` (auth.* absent from their type).
- Existing `examples/supabase` tests stay green.
- The `examples/supabase` example demonstrates the admin read (a handler or the test) so the walking skeleton exercises it.

## Surface-area decision (settled with operator)

Exposing internal namespaces on the `service_role` facade is the chosen surface for admin access to extension-owned tables — preferred over making users hand-construct a second db. Carries the caveat (in docs, not code): *Supabase-internal schema may drift across platform upgrades; prefer the GoTrue Admin API for user management.*

## Stop-and-surface

If facade-local composition turns out to require a **framework** change beyond the extension package (e.g. the execution context / namespace projection can't accept merged namespaces without a core change), STOP and report the precise seam rather than expanding scope. That's a finding worth surfacing — we've been bitten assuming these seams.

## Out of scope

- RLS authoring (slices B/C, gated on postgres-rls).
- Generic cross-space querying off the app db (deliberately not built; not this slice).
- `auth.*` access for `anon`/`authenticated` (they have no grants — not possible).
