# Slice 5 — dispatch plan

Spec: [`spec.md`](./spec.md). Branch: `slice/rls-ts-authoring` (off `main` at slice-4 tip `cdb8bd0e4`). Five dispatches, sequential, persistent Sonnet implementer + Opus reviewer. Tests-first throughout.

Per-dispatch gate (from [`drive/calibration/dod.md`](../../../../drive/calibration/dod.md)): build where typed exports change, forced typecheck, per-package `pnpm lint`, scoped `--filter` suites, `fixtures:check` when emission-adjacent, `lint:deps`, vocabulary ratchet.

## W1 — PSL policy table-name resolution (spec D6)

**Outcome:** `lowerRlsPolicyFromBlock` resolves the `target` model's declared storage name instead of lowercasing the model name's first character (`authoring.ts:139`). The resolution seam is **generic**: the PSL interpreter exposes model-name → storage-name lookup to entity-type factories (e.g. an optional field on `AuthoringEntityContext`, populated from the symbol table — the same information the `@@rls` attribute path already gets as `ctx.storageName`); the policy factory consumes it. No RLS vocabulary in the framework seam. A policy on an `@@map`'d model keys `tableName` to the declared storage name, agreeing with its `PostgresRlsEnablement`.
**Note:** the content hash excludes table identity, so wire names do not change — no fixture churn for existing contracts (`Profile`→`profile` already matched).
**Completed when:** AC-6 pinned — regression test with an `@@map`'d model (policy + `@@rls` agree on storage name); existing contract-psl + postgres-target + fixtures suites green byte-identically.
**Hands to W2:** PSL lowering is parity-ready; TS work can proceed against trustworthy PSL output.

## W2 — Policy/role/rls handles + helpers (inert values)

**Outcome:** `packages/3-extensions/postgres/src/contract/` (beside `native-enum.ts`) gains the helper surface, exported from `@prisma-next/postgres/contract-builder`: `policySelect`/`policyInsert`/`policyUpdate`/`policyDelete`/`policyAll` (model handle + descriptor → policy handle), `rlsEnabled(model)` → enablement handle, `role(name)` → role handle (usable as reference in `roles:` and as declaration in `entities`). Handles are inert branded values capturing inputs — no side effects, no hashing yet. Per-operation predicate typing is static (SELECT/DELETE: `using` only; INSERT: `withCheck` only; UPDATE/ALL: both); predicates type as `string | ((ctx: { ref: (handle) => string }) => string)`. `permissive` not authorable.
**Completed when:** helpers exist, typed, unit-tested (handle contents, type-level negative tests for the predicate matrix), exported; SQLite/Mongo contract-builder exports untouched.
**Hands to W3:** the handle vocabulary W3's lowering consumes.

## W3 — `entities` lowering in the postgres `defineContract`

**Outcome:** the postgres `defineContract` accepts `entities?: readonly …[]` and lowers it into the generic `packEntities` channel before delegating to `buildBoundContract`. Lowering: resolve each policy's target model to its **build-resolved** `(tableName, namespaceId)` via the exported `buildContractDefinition` (never re-derive from the model name); resolve role handles to sorted deduped names; evaluate function-form predicates with `ref(handle)` → qualified identifier; compute wire names via the landed `computeContentHash`/`normalizePredicate`/`formatRlsPolicyWireName` (export from `target-postgres` if not yet public); construct `PostgresRlsPolicy`/`PostgresRole`/`PostgresRlsEnablement`; fold into `packEntities` with PSL-matching keys (`policy`→prefix, `rls`→tableName, `role`→name). Spec-D5 diagnostics throw here, naming the prefix only.
**Completed when:** a TS contract using every helper emits `entries.policy`/`entries.rls`/`entries.role` with correct keys and wire names; round-trip through `contract.json` lossless; each D5 case throws; `ref()` output feeds the hash; postgres-extension + contract-ts suites green; zero RLS vocabulary added to `2-sql` (only, at most, an export of the existing generic model-lowering); `lint:deps` + ratchet clean.
**Hands to W4:** TS authoring is functionally complete; parity + pack exports remain.

## W4 — Supabase role exports + TS/PSL parity test (AC-1)

**Outcome:** the supabase pack exports `anon` / `authenticated` role handles from `@prisma-next/supabase/contract` beside `AuthUser` (built with W2's `role`; supabase already depends on `@prisma-next/postgres`). A parity fixture pair beside `test/integration/test/authoring/parity/` (native-enum pair is the template) authors the walking-skeleton policies **plus** all five operations **plus** an `@@map`'d model in both surfaces and pins structurally identical `entries.policy`/`entries.rls` with identical wire names and keys; declared-role parity is TS-only (no PSL role block — assert the TS side's `entries.role` directly).
**Completed when:** AC-1 green; AC-4's authoring half green (pack-exported handles flow to sorted bare names; `role(…)` in `entities` lands in `entries.role`); integration suite green.
**Hands to W5:** parity pinned; only live-PGlite behaviour + gate remain.

## W5 — TS walking skeleton on PGlite + invisibility + full gate

**Outcome:** the slice-1 scenario authored in TS runs against live PGlite with identical observable behaviour to the PSL run (rows filtered under `SET ROLE`, create/edit-replaces/rename/drop lifecycle, drift → verify fails, missing declared role fails verify) — beside the existing journeys (`packages/3-targets/6-adapters/postgres/test/migrations/rls-walking-skeleton-psl.integration.test.ts`; place the TS variant there if dependency rules allow `@prisma-next/postgres` as a devDep, else in `test/integration`). `ref()` rename behaviour pinned (AC-3: rename referenced model's table → predicate + wire name change). Invisibility pinned structurally (AC-7: no policy helper reachable from SQLite/Mongo builders).
**Completed when:** AC-2/3/4/7 green; full gate — build, forced typecheck, whole Lint job (ratchet unchanged), `fixtures:check`, `test:packages` + `test:integration` + `test:e2e`, multi-space guards, `check:upgrade-coverage --mode pr --prev $(git merge-base origin/main HEAD)`; slice-DoD walked; `origin/main` synced before final validation + push.

## Sequencing & handoffs

`W1 → W2 → W3 → W4 → W5`, strictly. W1 is independent (PSL-side) but first so W4's parity fixtures build on fixed PSL. W3 builds on W2's handles; W4 on W3's lowering; W5 on all.

## Known blast radius (from grounding)

- **W1's framework seam** touches `framework-authoring.ts` (`AuthoringEntityContext`) + the PSL interpreter — generic field, no RLS names; contract-psl tests exercise it.
- **Wire names never move** in this slice (hash excludes table identity; no hash-input changes) — any fixture diff beyond `tableName` fields on `@@map` fixtures is a red flag.
- **`packEntities` fold** must reuse the existing per-namespace collision guards; policy keyed by prefix means a duplicate prefix per namespace collides there — W3's diagnostic must fire before the generic guard's less-specific error.
- **New public exports** on `@prisma-next/postgres/contract-builder` + `@prisma-next/supabase/contract` are additive (no upgrade instructions expected); `check:upgrade-coverage` confirms.
- **`buildContractDefinition` double-lowering** (wrapper + build) is pure/idempotent over builders; if it proves observable (warnings, perf), the implementer surfaces it rather than caching ad hoc.

## Linear

Ticket [TML-2883](https://linear.app/prisma-company/issue/TML-2883) (In Progress). Last slice of the postgres-rls critical path (TML-2870 → TML-2883).
