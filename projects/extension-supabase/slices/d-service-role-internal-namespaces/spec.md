# Slice D — `service_role` queries Supabase-internal namespaces via a secondary `db.supabase` root

**Project:** extension-supabase (TML-2503) · **Spec:** [`../../spec.md`](../../spec.md) · **Plan:** [`../../plan.md`](../../plan.md) · **Decision:** [C15](../../../supabase-integration/decisions.md)

## Why now

Independent of postgres-rls #771 — this is facade composition, not RLS. Good use of the wait.

## The capability

The Supabase extension contract is exposed as a **secondary root** on the `service_role`-bound db — its own intact surface, alongside the app's primary root:

```ts
const admin = db.asServiceRole();
admin.sql.public.profile.select({ … })     // primary root (app contract) — unchanged
admin.supabase.sql.auth.users.select({ … }) // secondary root (extension contract)
admin.supabase.orm.auth.AuthUser.find({ … })

db.asAnon().sql.public.profile               // ✅ app root only
db.asAnon().supabase                         // ✗ not on the type — only asServiceRole has it
```

The capability is **bound to the role that holds the grant.** Only `service_role` can read `auth.*` over a direct Postgres connection, so `.supabase` appears *only* on the `asServiceRole()`-bound db. `asUser(jwt)` / `asAnon()` are unchanged — app root only, no `.supabase`.

## Design — a separate root, not a merge

The runtime is **contract-bound by `storageHash`** (`SqlFamilyAdapter.validatePlan` requires `plan.meta.storageHash === context.contract.storage.storageHash`). A plan built against the extension contract carries the extension's hash and therefore **cannot** run on the app runtime. So `.supabase` is a genuinely separate root, not a merge:

- The extension contract is deserialized into its **own** `ExecutionContext` (`createExecutionContext({ contract: extContract, stack })`, reusing the app's stack — codecs all resolve).
- A **second `SupabaseRuntimeImpl`** is bound to that context, constructed with the **same `driver` instance** as the app runtime (one shared pool — no second `Pool`/`connect`), and with **marker-verification off** (the `external` extension contract owns no app-space marker, so verifying its hashes would spuriously fail; the app runtime still verifies normally).
- `db.asServiceRole().supabase = { sql, orm, execute }` over that context, routed through the ext runtime's `executeWithRole`/`openRoleSession` with the `{ role: 'service_role' }` binding (same session-coupled-connection path as the app role binding).

**The two contracts are never merged.** A first attempt that spread the extension's namespaces into the app contract (`buildServiceRoleContract` / `WithExtensionNamespaces`) was rejected — merging breaks `storageHash` identity, codec-registry uniqueness, and the marker check. Two intact contexts/runtimes sharing one pool is the sanctioned shape (the ADR 230 pattern).

## Done conditions (operator-observable)

- Integration test (PGlite + `bootstrapSupabaseShim`, `service_role`): `db.asServiceRole().supabase.sql.auth.users` reads a seeded row, asserting the row + that emitted SQL targets `"auth"."users"` + that `current_setting('role')` is `service_role`. Same via `.supabase.orm.auth.AuthUser`. The app primary root (`asServiceRole().sql.public.profile`) still works.
- Type-level: `asServiceRole().supabase.{sql,orm}` carry `auth`/`storage`; `asServiceRole().sql` (primary root) does **not** carry `auth`; `asAnon()`/`asUser()` have **no** `.supabase`.
- Existing `examples/supabase` tests stay green; the example exercises the admin read.

## Out of scope

- RLS authoring (slices B/C, gated on postgres-rls).
- Generic cross-space querying off the **app** db (deliberately not built; not this slice).
- `auth.*` access for `anon`/`authenticated` (no grants — not possible).
- A single transaction spanning the app root and the `.supabase` root (the two roots use separate runtimes / unpinned connections; v1 limitation — see [C15](../../../supabase-integration/decisions.md) future direction: a runtime bound to the aggregate contract).
