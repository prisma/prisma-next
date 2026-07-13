# Contract fidelity notes

The shipped contract (`contract.prisma` → emitted `contract.json` / `contract.d.ts`) is **generated, not hand-authored**: `pnpm contract:generate` restores the reference fixture ([`test/fixtures/supabase-reference/`](../../test/fixtures/supabase-reference/)) into a fresh PGlite database, introspects the `auth` and `storage` schemas, infers PSL per schema, assembles the two `namespace` blocks plus the three top-level `role` blocks (from `src/contract/roles.ts`'s `SUPABASE_ROLES`), and emits. Rerunning against the same fixture is byte-identical. `contract.prisma` is fully self-describing — nothing is injected outside of PSL text during emit.

**Reference version:** supabase/postgres:17.6.1.106 (PostgreSQL 17.6), gotrue v2.188.1, storage-api v1.54.1, captured 2026-07-12 with supabase CLI 2.95.4. Supabase-internal schema drifts across platform upgrades; refresh by re-capturing the fixture from a newer stack and rerunning `contract:generate`.

## The safety asymmetry this file relies on

Everything the pack declares is `control: 'external'`. Under `external`, `db verify` **fails on a declared shape the live database lacks** and **tolerates everything live that the contract does not declare** (extra schemas, tables, columns, indexes, defaults). So *under-declaring is safe and wrong-declaring is not* — every entry below is an omission, never an approximation. The round-trip test (`test/reference-fixture-verify.integration.test.ts`) pins that the shipped contract verifies clean against the restored reference, with the undeclared schemas (`realtime`, `vault`, …) present.

## What the contract deliberately does not declare

Machine-readable versions of these lists live in `scripts/generate-contract.ts` (`COLUMN_OMISSIONS` / `DEFAULT_OMISSIONS` / `INDEX_OMISSIONS`), each with the full reasoning; this is the audit summary.

**Columns (2):**

| Column | Live type | Why |
| --- | --- | --- |
| `storage.buckets.allowed_mime_types` | `text[]` nullable | PSL has no nullable-list syntax (`String[]?` is invalid) |
| `storage.objects.path_tokens` | `text[]` nullable | Same; also `GENERATED ALWAYS`, so not user-writable regardless |

**Column defaults (8):** `auth.users.phone` (`DEFAULT NULL` no-op), `auth.custom_oauth_providers.acceptable_client_ids`/`scopes` (list defaults have no PSL execution-default form), and `auth.custom_oauth_providers.attribute_mapping`/`authorization_params`, `auth.webauthn_credentials.transports`, `storage.iceberg_namespaces.metadata` (JSON-literal defaults resolve to different shapes on the authored vs introspected side). Column types are declared in full; only the `@default` is dropped.

**Indexes:**

- The reference's 8 partial unique indexes (`WHERE`-predicated, on `auth.users` token columns, `auth.mfa_factors`, `storage.buckets_analytics`) are not declared — the inferrer never promotes an index-level unique into `@@unique`, and a predicate-less declaration would misdeclare.
- `auth.one_time_tokens`' two `USING hash` indexes are not declared — `hash` is not a registered index type on this stack (`IndexTypeRegistry` is pack-populated; the postgres target registers none).
- 16 foreign keys whose source columns have **no live backing index** are declared with `@relation(..., index: false)` — real Supabase does not index those FK columns, and the default FK-derived index expectation would otherwise fail verify. (This PSL argument and the inferrer support for it shipped with this contract.)

**Generated columns** (`auth.users.confirmed_at`, `auth.identities.email`): declared as ordinary columns. Introspection reports them identically on the authored and live sides, so verify is clean; the contract does not record the generation expression.

## What is complete

Every `auth` (23) and `storage` (10) table of the reference version, all 10 native enum types, and the three platform roles. Schemas the pack does not own (`realtime`, `vault`, `pgsodium`, `extensions`, `graphql*`, `net`, `supabase_functions`, `_realtime`) are deliberately undeclared — see the scope decision in [`projects/supabase-integration/deferred.md`](../../../../../projects/supabase-integration/deferred.md).
